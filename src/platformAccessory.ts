import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { BitwisePushGarageDoor } from './platform';
import { CurrentDoorState, ObstructionDetected, TargetDoorState } from 'hap-nodejs/dist/lib/definitions';

export type BitwiseDeviceContext = {
  name: string;
  ip: string;
};

export class BitwisePushGarageDoorAccessory {
  private service: Service;

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
  }

  async onGetDoorState(): Promise<CharacteristicValue> {
    const state = CurrentDoorState.CLOSED;
    this.platform.log.debug('Get Characteristic On ->', state);

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    return state;
  }

  async onGetTargetDoorState(): Promise<CharacteristicValue> {
    const state = CurrentDoorState.CLOSED;
    this.platform.log.debug('Get Target Door State -> ', state);
    return state;
  }

  async onSetTargetDoorState(value: CharacteristicValue) {
    this.platform.log.debug('Set Target Door State -> ', value);
  }

  async onGetObstructionDetected(): Promise<CharacteristicValue> {
    this.platform.log.debug('Get Obstruction Detected -> ', false);
    return false;
  }
}
