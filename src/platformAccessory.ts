import got from 'got';
import * as net from 'net';
import * as dgram from 'dgram';
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { XMLParser } from 'fast-xml-parser';

import { BitwisePushGarageDoor } from './platform';
import { PromiseSocket } from './tcp';
import { CurrentDoorState } from 'hap-nodejs/dist/lib/definitions';

const TCP_SOCKETS: Record<string, PromiseSocket> = {};

export type BitwiseDeviceContext = {
  name: string;
  ip: string;
  output: number;
  tcpport: number;
  udpport: number;
  threshold?: number;
};

export class BitwisePushNAKError extends Error {
  constructor (message: string) {
    super(message);
  }
}

export class BitwisePushAccessory {
  private service: Service;

  private targetState: number; // TargetDoorState

  constructor(
    private readonly platform: BitwisePushGarageDoor,
    private readonly accessory: PlatformAccessory<BitwiseDeviceContext>,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'BitWise')
      .setCharacteristic(this.platform.Characteristic.Model, 'Push')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.name);

    this.service = this.accessory.getService(this.platform.Service.GarageDoorOpener) ||
    this.accessory.addService(this.platform.Service.GarageDoorOpener);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.name);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentDoorState)
      .onGet(this.onGetDoorState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetDoorState)
      .onGet(this.onGetTargetDoorState.bind(this))
      .onSet(this.onSetTargetDoorState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.ObstructionDetected)
      .onGet(this.onGetObstructionDetected.bind(this));

    this.targetState = 0;
    setTimeout(async () => {
      this.targetState = (await this.onGetDoorState()) as number;
      this.platform.log.info('Set Initial Door Target State -> ', this.targetState);
    }, 100);
  }

  async onGetDoorState(): Promise<CharacteristicValue> {
    this.platform.log.debug('Get Current Door State');

    const open = await this.readStateFromBox();

    if (open) {
      return CurrentDoorState.OPEN;
    } else {
      return CurrentDoorState.CLOSED;
    }
  }

  async onGetTargetDoorState(): Promise<CharacteristicValue> {
    this.platform.log.debug('Get Target Door State');

    const open = await this.readStateFromBox();

    if (open) {
      return CurrentDoorState.OPEN;
    } else {
      return CurrentDoorState.CLOSED;
    }
  }

  async onSetTargetDoorState() {
    this.platform.log.info('Trigger Door');

    const context = this.accessory.context;

    const outputtype = 'pulse:2'; // pulse, output type BCX relay
    const output = this.accessory.context.output;

    const command = `bwc:set:${outputtype}:${output}:50:`;
    await this.sendUdpCommand({ command, ipaddress: context.ip, port: context.udpport });
  }

  async onGetObstructionDetected(): Promise<CharacteristicValue> {
    this.platform.log.info('Get Obstruction Detected -> ', false);
    return false;
  }

  async readStateFromBox(): Promise<boolean> {
    const context = this.accessory.context;

    const command = `bwc:get:ad:${context.output}:`;
    const response = await this.sendTcpCommand({ command, ipaddress: context.ip, port: context.tcpport });

    if (!response) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [value, min, max] = response.split(':').slice(4, 7);
    const maxInt = parseInt(max);

    const isOpen = maxInt >= (context.threshold ?? 200); // greater = open

    this.platform.log.debug('Get Current Door isOpen ->', isOpen);

    return isOpen;
  }

  async sendHttpCommand({ command, hostname }): Promise<string> {
    const url = `http://${hostname}/bwc.xml?bwc=${command}`;
    this.platform.log.info('Requesting: ' + url);

    const res = await got.get(url);
    const parser = new XMLParser();
    const data = parser.parse(res.body);
    this.platform.log.debug('Received: ' + data);

    const bwr = data.response.bwr;
    this.platform.log.debug('Response: ' + bwr);

    if (bwr.startsWith('NAK:')) {
      throw new BitwisePushNAKError(bwr);
    }

    return bwr;
  }

  async sendTcpCommand({ command, ipaddress, port }: { command: string; ipaddress: string; port: number }): Promise<string> {
    let socket = TCP_SOCKETS[ipaddress];
    if (!socket) {
      this.platform.log.info('Creating new TCP socket');

      const client = new net.Socket();
      client.setKeepAlive(true, 5000);
      client.setTimeout(2000);
      socket = new PromiseSocket(client);
      TCP_SOCKETS[ipaddress] = socket;

      this.platform.log.info(`TCP connecting to ${ipaddress}:${port}`);
      await socket.connect(port, ipaddress);
      this.platform.log.info(`TCP connected to ${ipaddress}:${port}`);

      socket.socket.on('close', () => {
        this.platform.log.info(`TCP connection closed: ${ipaddress}:${port}`);
      });

      socket.socket.on('timeout', () => {
        this.platform.log.info(`TCP connection timed out: ${ipaddress}:${port}`);
      });
    }

    if (socket.socket.closed || socket.socket.readyState === 'closed') {
      this.platform.log.info(`TCP connection was closed, reconnecting: ${ipaddress}:${port}`);
      await socket.connect(port, ipaddress);
      this.platform.log.info(`TCP connected to ${ipaddress}:${port}`);
    }

    await socket.write(command + '\r\n');

    return await new Promise((resolve, reject) => {
      const onData = (data) => {
        const body = data.toString('utf-8');
        if (body.startsWith('bwr:')) {
          socket.socket.off('data', onData);
          socket.socket.off('error', onError);
          return resolve(body);
        }
      };

      const onError = (err) => {
        this.platform.log.error('TCP Connection errored:', err);
        socket.socket.off('data', onData);
        socket.socket.off('error', onError);
        return reject(err);
      };

      socket.socket.on('data', onData);
      socket.socket.on('error', onError);
    });
  }

  async sendUdpCommand({ command, ipaddress, port }): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
      this.platform.log.info('UDP command: ' + command);

      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      socket.send(command, 0, command.length, port, ipaddress, (err, bytes) => {
        if (err) {
          this.platform.log.info('UDP error: ' + err);
          return reject(err);
        }
        this.platform.log.info('UDP success: ' + bytes);
        return resolve(bytes);
      });
    });
  }
}
