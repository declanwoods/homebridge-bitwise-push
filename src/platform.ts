import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { BitwiseDeviceContext, BitwisePushGarageDoorAccessory } from './platformAccessory';

export type BitwisePushGarageDoorConfig = {
  devices?: {
    name: string;
    ip: string;
    port: number;
    output: number;
    threshold?: number;
  }[];
};

export class BitwisePushGarageDoor implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory<BitwiseDeviceContext>[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform: ', config.devices?.length, ' device/s');

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory<BitwiseDeviceContext>) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    const config = this.config as BitwisePushGarageDoorConfig;

    for (const device of config.devices ?? []) {
      const uuid = this.api.hap.uuid.generate(device.ip);
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

        existingAccessory.context.name = device.name;
        existingAccessory.context.ip = device.ip;
        existingAccessory.context.port = device.port;
        existingAccessory.context.output = device.output;
        existingAccessory.context.threshold = device.threshold;
        this.api.updatePlatformAccessories([existingAccessory]);

        new BitwisePushGarageDoorAccessory(this, existingAccessory);
      } else {
        this.log.info('Adding new accessory:', device.name);

        // create a new accessory
        const accessory = new this.api.platformAccessory<BitwiseDeviceContext>(device.name, uuid);
        accessory.context.name = device.name;
        accessory.context.ip = device.ip;
        accessory.context.port = device.port;
        accessory.context.output = device.output;
        accessory.context.threshold = device.threshold;

        new BitwisePushGarageDoorAccessory(this, accessory);

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
    // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
  }
}
