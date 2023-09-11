import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { BitwisePushGarageDoor } from './platform';
import * as net from 'net';

export type BitwiseDeviceContext = {
  name: string;
  ip: string;
  tcpport: number;
  udpport: number;
  output: number;
  threshold?: number;
};

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
    this.platform.log.info('Get Current Door State');

    const state = await this.readStateFromBox();

    this.platform.log.info('Get Current Door State Value -> ', state);

    return state;
  }

  async onSet() {
    this.platform.log.info('Trigger Door');

    const context = this.accessory.context;

    const outputtype = 'pulse:2';
    const output = this.accessory.context.output;

    const command = `bwc:set:${outputtype}:${output}:1:`;
    await this.sendTcpCommand({ command, ipaddress: context.ip, port: context.tcpport });
  }

  async readStateFromBox(): Promise<boolean> {
    const context = this.accessory.context;

    const command = `bwc:get:ad:${context.output}:`;
    const response = await this.sendTcpCommand({ command, ipaddress: context.ip, port: context.tcpport });

    if (!response) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    this.platform.log.info('Get Current Door Response -> ', response);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [value, min, max] = response.split(':').slice(4, 7);
    const maxInt = parseInt(max);

    const state = maxInt >= (context.threshold ?? 200); // greater = open

    return state;
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
