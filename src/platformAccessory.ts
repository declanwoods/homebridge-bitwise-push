import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { BitwisePushGarageDoor } from './platform';
import { CurrentDoorState, TargetDoorState } from 'hap-nodejs/dist/lib/definitions';
import { Socket, SocketOptions, createSocket } from 'dgram';
import * as net from 'net';

export type BitwiseDeviceContext = {
  name: string;
  ip: string;
  tcpport: number;
  udpport: number;
  output: number;
  threshold?: number;
};

export class BitwisePushGarageDoorAccessory {
  private service: Service;
  private socket: Socket;

  private targetState: number; // TargetDoorState

  constructor(
    private readonly platform: BitwisePushGarageDoor,
    private readonly accessory: PlatformAccessory<BitwiseDeviceContext>,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'BitWise')
      .setCharacteristic(this.platform.Characteristic.Model, 'Push')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, '');

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

    const opts: SocketOptions = { type: 'udp4', reuseAddr: true };
    this.socket = createSocket(opts);

    this.targetState = 0;
    setTimeout(async () => {
      this.targetState = (await this.onGetDoorState()) as number;
    }, 100);
  }

  async onGetDoorState(): Promise<CharacteristicValue> {
    this.platform.log.info('Get Current Door State');
    this.platform.log.info('Current Target Door State -> ', this.targetState);
    const context = this.accessory.context;

    const output = context.output;
    const command = `bwc:get:ad:${output}:`;

    const response = await this.sendTcpCommand({ command, ipaddress: context.ip, port: context.tcpport });

    if (!response) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.platform.log.info('Get Current Door response -> ', response);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [value, min, max] = response.split(':').slice(4, 7);
    const maxInt = parseInt(max);

    let state = CurrentDoorState.OPEN;
    if (maxInt < 200) {
      state = CurrentDoorState.CLOSED;
    }

    this.platform.log.info('Get Current Door State Value -> ', state);

    return state;
  }

  async onGetTargetDoorState(): Promise<CharacteristicValue> {
    this.platform.log.info('Get Target Door State -> ', this.targetState);
    return this.targetState;
  }

  async onSetTargetDoorState(value: CharacteristicValue) {
    this.platform.log.info('Set Target Door State -> ', value);
    this.platform.log.info('Current Target Door State -> ', this.targetState);

    const context = this.accessory.context;

    const outputtype = 'pulse:2';
    const output = this.accessory.context.output;

    const currentDoorState = (await this.onGetDoorState()) as number;

    if ((value === TargetDoorState.OPEN && currentDoorState === TargetDoorState.CLOSED) ||
        (value === TargetDoorState.CLOSED && currentDoorState === TargetDoorState.OPEN)) {
      this.targetState = value as number;
      const command = `bwc:set:${outputtype}:${output}:1:`;
      await this.sendTcpCommand({ command, ipaddress: context.ip, port: context.tcpport });
    }
  }

  async onGetObstructionDetected(): Promise<CharacteristicValue> {
    this.platform.log.info('Get Obstruction Detected -> ', false);
    return false;
  }

  async sendTcpCommand({ command, ipaddress, port }) {
    return await new Promise<string>((resolve, reject) => {
      const client = new net.Socket();
      client.connect(port, ipaddress, () => {
        this.platform.log.info(`Connected to ${ipaddress}:${port}`);
        client.write(command + '\r\n');
      });

      client.on('data', (data) => {
        const body = data.toString('utf-8');
        if (body.startsWith('bwr:')) {
          this.platform.log.info('Received: ' + body);
          client.write('bwc:tcpclose:\r\n');
          client.destroy();
          return resolve(body);
        }
      });

      client.on('error', (err) => {
        this.platform.log.info('Connection errored');
        return reject(err);
      });

      client.on('close', () => {
        return;
      });
    });
  }
}
