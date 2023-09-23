import got from 'got';
import * as net from 'net';
import * as dgram from 'dgram';
import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
import { XMLParser } from 'fast-xml-parser';

import { BitwisePushGarageDoor } from './platform';

const TCP_SOCKETS: Record<string, net.Socket> = {};

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

export class BitwisePushButtonAccessory {
  private service: Service;

  constructor(
    private readonly platform: BitwisePushGarageDoor,
    private readonly accessory: PlatformAccessory<BitwiseDeviceContext>,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'BitWise')
      .setCharacteristic(this.platform.Characteristic.Model, 'Push')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.name);

    this.service = this.accessory.getService(this.platform.Service.Switch) ||
        this.accessory.addService(this.platform.Service.Switch);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.name);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.onGet.bind(this))
      .onSet(this.onSet.bind(this));
  }

  async onGet(): Promise<CharacteristicValue> {
    this.platform.log.debug('Get Current Door State');

    const state = await this.readStateFromBox();

    return state;
  }

  async onSet() {
    this.platform.log.info('Trigger Door');

    const context = this.accessory.context;

    const outputtype = 'pulse:2'; // pulse, output type BCX relay
    const output = this.accessory.context.output;

    const command = `bwc:set:${outputtype}:${output}:50:`;
    await this.sendUdpCommand({ command, ipaddress: context.ip, port: context.udpport });
  }

  async readStateFromBox(): Promise<boolean> {
    const context = this.accessory.context;

    const command = `bwc:get:ad:${context.output}:`;
    const response = await this.sendHttpCommand({ command, hostname: context.ip });

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
    return await new Promise<string>((resolve, reject) => {
      let client: net.Socket = TCP_SOCKETS[ipaddress];
      if (!client) {
        client = new net.Socket();
        client.setKeepAlive(true, 5000);
        TCP_SOCKETS[ipaddress] = client;
      }

      if (client.closed || client.readyState === 'closed') {
        client.connect(port, ipaddress, () => {
          this.platform.log.debug(`Connected to ${ipaddress}:${port}`);
          client.write(command + '\r\n');
        });
      } else {
        client.write(command + '\r\n');
      }

      client.on('data', (data) => {
        const body = data.toString('utf-8');
        if (body.startsWith('bwr:')) {
          this.platform.log.debug('Received: ' + body);
          client.write('bwc:tcpclose:\r\n');
          client.destroy();
          return resolve(body);
        }
      });

      client.on('error', (err) => {
        this.platform.log.error('Connection errored:', err);
        return reject(err);
      });

      client.on('close', () => {
        return;
      });
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
