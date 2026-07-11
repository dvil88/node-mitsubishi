/**
 * Mitsubishi Air Conditioner Protocol Parser
 *
 * This module contains all the parsing logic for Mitsubishi AC protocol payloads,
 * including enums, state classes, and functions for decoding hex values.
 */

import { createLogger } from './helpers/logger';
import { allZero, bytesEqual, enumValues, hex } from './helpers/bytes';


export const logger = createLogger('mitsubishi_parser');


export enum PowerOnOff {
  OFF = 0,
  ON = 1,
}

export enum DriveMode {
  AUTO = 0,
  HEATER = 1,
  DEHUM = 2,
  COOLER = 3,
  FAN = 7,
}

export enum WindSpeed {
  AUTO = 0,
  S1 = 1,
  S2 = 2,
  S3 = 3,
  // value 4 does not seem to exist?
  S4 = 5,
  FULL = 6,
}

export enum VerticalWindDirection {
  AUTO = 0,
  V1 = 1,
  V2 = 2,
  V3 = 3,
  V4 = 4,
  V5 = 5,
  SWING = 7,
}

export enum HorizontalWindDirection {
  AUTO = 0,
  FAR_LEFT = 1,
  LEFT = 2,
  CENTER = 3,
  RIGHT = 4,
  FAR_RIGHT = 5,
  LEFT_CENTER = 6,
  CENTER_RIGHT = 7,
  LEFT_RIGHT = 8,
  LEFT_CENTER_RIGHT = 9, // I don't see a difference in vane position vs 8
  SWING = 12,
}

export enum AutoMode {
  OFF = 0,
  SWITCHING = 1,
  AUTO_HEATING = 2,
  AUTO_COOLING = 3,
}

export enum RemoteLock {
  Unlocked = 0,
  PowerLocked = 1,
  ModeLocked = 2,
  TemperatureLocked = 4,
}

export enum Controls {
  NoControl = 0,
  PowerOnOff = 0x0100,
  DriveMode = 0x0200,
  Temperature = 0x0400,
  WindSpeed = 0x0800,
  UpDownWindDirection = 0x1000,
  // 0x2000
  RemoteLock = 0x4000,
  // 0x8000
  LeftRightWindDirect = 0x0001,
  OutsideControl = 0x0002,
  // 0x0004
  // 0x0008
  // 0x0010
  // 0x0020
  // 0x0040
  // 0x0080
}

export enum Controls08 {
  NoControl = 0,
  // 0x01
  // 0x02
  Dehum = 0x04,
  PowerSaving = 0x08,
  Buzzer = 0x10,
  WindAndWindBreak = 0x20,
  // 0x40
  // 0x80
}

export enum SetRemoteTemperatureMode {
  UseInternal = 0x00,
  RemoteTemp = 0x01,
}

export function logUnexpectedValue(codeValue: string, position: number, value: number | Buffer): void {
  const svalue = Buffer.isBuffer(value) ? `[${value.toString('hex')}]` : String(value);
  logger.info(
    `Unexpected value found in ${codeValue} at position ${position}: ${svalue}. ` +
      `Please report this, so this can be added to the decoding. ` +
      `Try to describe what was happening around the time of this value.`,
  );
}

function tryEnumOrLog<T extends number>(
  codeValue: string,
  position: number,
  value: number,
  validValues: readonly number[],
): T {
  if (validValues.includes(value)) {
    return value as T;
  }
  logUnexpectedValue(codeValue, position, value);
  return value as T;
}


/** Parsed general AC states from device response */
export class GeneralStates {
  powerOnOff: PowerOnOff = PowerOnOff.OFF;
  driveMode: DriveMode = DriveMode.AUTO;
  coarseTemperature = 22;
  fineTemperature: number | null = 22.0;
  windSpeed: WindSpeed = WindSpeed.AUTO;
  verticalWindDirection: VerticalWindDirection = VerticalWindDirection.AUTO;
  remoteLock: RemoteLock = RemoteLock.Unlocked;
  horizontalWindDirection: HorizontalWindDirection = HorizontalWindDirection.AUTO;
  dehumSetting = 0;
  isPowerSaving = false;
  windAndWindBreakDirect = 0;
  iSeeSensor = true; // i-See sensor active flag
  wideVaneAdjustment = false;

  get temperature(): number {
    if (this.fineTemperature !== null) {
      return this.fineTemperature;
    }
    return this.coarseTemperature;
  }

  set temperature(value: number) {
    this.fineTemperature = value;
    this.coarseTemperature = Math.trunc(value);
  }

  get tempMode(): boolean {
    return this.fineTemperature !== null;
  }

  /** Check if payload contains general states data */
  static isGeneralStatesPayload(data: Buffer): boolean {
    if (data.length < 6) {
      return false;
    }
    return (data[1] === 0x62 || data[1] === 0x7b) && data[5] === 0x02;
  }

  /**
   * Parse general states from hex payload with enhanced SwiCago-based parsing.
   *
   * Enhanced with SwiCago insights:
   * - Dual temperature parsing modes (segment vs direct)
   * - Wide vane adjustment flag detection
   * - i-See sensor detection from mode byte
   */
  static parseGeneralStates(data: Buffer): GeneralStates {
    const name = 'GeneralStates';
    logger.debug(`Parsing general states payload: ${hex(data)}`);

    if (data.length < 21) {
      throw new Error('GeneralStates payload too short');
    }

    if (data[0] !== 0xfc) {
      throw new Error(`GeneralStates[0] == 0x${data[0].toString(16).padStart(2, '0')} != 0xfc`);
    }

    const calculatedFcc = calcFcc(data.subarray(1, -1));
    if (calculatedFcc !== data[data.length - 1]) {
      throw new Error(
        `Invalid checksum, expected 0x${calculatedFcc.toString(16).padStart(2, '0')}, ` +
          `received 0x${data[data.length - 1].toString(16).padStart(2, '0')}`,
      );
    }

    // Verify for parts that we think are static:
    if (data[1] !== 0x62 && data[1] !== 0x7b) {
      logUnexpectedValue(name, 1, data.subarray(1, 2));
    }
    if (!bytesEqual(data.subarray(2, 5), [0x01, 0x30, 0x10])) {
      logUnexpectedValue(name, 2, data.subarray(2, 5));
    }
    if (data[5] !== 0x02) {
      throw new Error(`Not GeneralStates message: data[5] == 0x${data[5].toString(16).padStart(2, '0')} != 0x02`);
    }

    const obj = new GeneralStates();

    if (!bytesEqual(data.subarray(6, 8), [0, 0])) {
      logUnexpectedValue(name, 6, data.subarray(6, 8));
    }

    obj.powerOnOff = tryEnumOrLog(name, 8, data[8], enumValues(PowerOnOff));

    obj.driveMode = tryEnumOrLog(name, 9, data[9] & 0x07, enumValues(DriveMode));
    obj.iSeeSensor = Boolean(data[9] & 0x08);
    if ((data[9] & 0xf0) !== 0x00) {
      logUnexpectedValue(name, 9, data.subarray(9, 10));
    }

    obj.coarseTemperature = 31 - data[10];
    obj.windSpeed = tryEnumOrLog(name, 11, data[11], enumValues(WindSpeed));
    obj.verticalWindDirection = tryEnumOrLog(name, 12, data[12], enumValues(VerticalWindDirection));
    obj.remoteLock = tryEnumOrLog(name, 13, data[13], enumValues(RemoteLock));

    if (data[14] !== 0) {
      logUnexpectedValue(name, 14, data[14]);
    }

    // Enhanced wide vane parsing with adjustment flag (SwiCago)
    const wideVaneData = data[15]; // data[10] in SwiCago
    obj.horizontalWindDirection = tryEnumOrLog(name, 15, wideVaneData & 0x0f, enumValues(HorizontalWindDirection)); // Lower 4 bits
    obj.wideVaneAdjustment = (wideVaneData & 0xf0) === 0x80; // Upper 4 bits = 0x80

    if (data[16] !== 0x00) {
      obj.fineTemperature = (data[16] - 0x80) / 2;
    } else {
      obj.fineTemperature = null;
    }

    // Extra states
    obj.dehumSetting = data[17];
    obj.isPowerSaving = data[18] > 0;
    obj.windAndWindBreakDirect = data[19];

    if (!allZero(data.subarray(20, -1))) {
      // don't include the FCC
      logUnexpectedValue(name, 20, data.subarray(20, -1));
    }

    return obj;
  }

  generateGeneralCommand(controls: Controls): Buffer {
    const cmd = Buffer.alloc(20);
    Buffer.from([0x41, 0x01, 0x30, 0x10, 0x01]).copy(cmd);

    controls |= Controls.OutsideControl;
    cmd.writeUInt16BE(controls & 0xffff, 5);
    cmd[7] = this.powerOnOff;
    cmd[8] = this.driveMode;
    // TODO: figure out how to combine mode with iSee; Mode changes don't seem to work when >0x08
    cmd[9] = 31 - Math.trunc(this.temperature);
    cmd[10] = this.windSpeed;
    cmd[11] = this.verticalWindDirection;
    cmd[12] = 0;
    cmd[13] = 0;
    cmd[14] = 0;

    cmd[15] = this.remoteLock; // Changes written in different location vs current status
    // https://github.com/pymitsubishi/pymitsubishi/issues/13#issuecomment-3346213470

    cmd[16] = 0;
    cmd[17] = this.horizontalWindDirection;
    cmd[18] = this.fineTemperature !== null ? 0x80 + Math.trunc(this.fineTemperature * 2) : 0x00;
    cmd[19] = 0x41;

    // Calculate and append FCC
    const fcc = calcFcc(cmd);
    return Buffer.concat([Buffer.from([0xfc]), cmd, Buffer.from([fcc])]);
  }

  generateExtend08Command(controls: Controls08): Buffer {
    const cmd = Buffer.alloc(20);
    Buffer.from([0x41, 0x01, 0x30, 0x10, 0x08]).copy(cmd);
    cmd[5] = controls & 0xff;
    // cmd[6:8] = 0
    cmd[8] = controls & Controls08.Dehum ? this.dehumSetting : 0;
    cmd[9] = this.isPowerSaving ? 0x0a : 0x00;
    cmd[10] = controls & Controls08.WindAndWindBreak ? this.windAndWindBreakDirect : 0x00;
    cmd[11] = controls & Controls08.Buzzer ? 0x01 : 0x00;
    // cmd[12:20] = 0

    const fcc = calcFcc(cmd);
    return Buffer.concat([Buffer.from([0xfc]), cmd, Buffer.from([fcc])]);
  }
}

/** Parsed sensor states from device response */
export class SensorStates {
  insideTemperature1Coarse = 24;
  outsideTemperature: number | null = 21.0;
  insideTemperature1Fine: number | null = 24.5;
  insideTemperature2: number | null = 24.0;
  runtimeMinutes = 0;

  get roomTemperature(): number {
    if (this.insideTemperature1Fine !== null) {
      return this.insideTemperature1Fine;
    }
    return this.insideTemperature1Coarse;
  }

  /** Check if payload contains sensor states data */
  static isSensorStatesPayload(data: Buffer): boolean {
    if (data.length < 6) {
      return false;
    }
    return (data[1] === 0x62 || data[1] === 0x7b) && data[5] === 0x03;
  }

  /** Parse sensor states from hex payload */
  static parseSensorStates(data: Buffer): SensorStates {
    const name = 'SensorStates';
    logger.debug(`Parsing sensor states payload: ${hex(data)}`);
    if (data.length < 21) {
      throw new Error('SensorStates payload too short');
    }

    if (data[0] !== 0xfc) {
      throw new Error(`SensorStates[0] == 0x${data[0].toString(16).padStart(2, '0')} != 0xfc`);
    }

    const calculatedFcc = calcFcc(data.subarray(1, -1));
    if (calculatedFcc !== data[data.length - 1]) {
      throw new Error(
        `Invalid checksum, expected 0x${calculatedFcc.toString(16).padStart(2, '0')}, ` +
          `received 0x${data[data.length - 1].toString(16).padStart(2, '0')}`,
      );
    }

    // Verify for parts that we think are static:
    if (data[1] !== 0x62 && data[1] !== 0x7b) {
      logUnexpectedValue(name, 1, data.subarray(1, 2));
    }
    if (!bytesEqual(data.subarray(2, 5), [0x01, 0x30, 0x10])) {
      logUnexpectedValue(name, 2, data.subarray(2, 5));
    }
    if (data[5] !== 0x03) {
      throw new Error(`Not SensorStates message: data[5] == 0x${data[5].toString(16).padStart(2, '0')} != 0x03`);
    }

    const obj = new SensorStates();

    if (!bytesEqual(data.subarray(6, 8), [0, 0])) {
      logUnexpectedValue(name, 6, data.subarray(6, 8));
    }

    obj.insideTemperature1Coarse = 10 + data[8];

    if (data[9] !== 0) {
      logUnexpectedValue(name, 9, data.subarray(9, 10));
    }

    obj.outsideTemperature = (data[10] - 0x80) * 0.5;
    if (obj.outsideTemperature === -64) {
      obj.outsideTemperature = null;
    }

    obj.insideTemperature1Fine = (data[11] - 0x80) * 0.5;
    if (obj.insideTemperature1Fine === -64) {
      obj.insideTemperature1Fine = null;
    }

    obj.insideTemperature2 = (data[12] - 0x80) * 0.5;
    if (obj.insideTemperature2 === -64) {
      obj.insideTemperature2 = null;
    }
    // What's the difference between data[8], data[11] and data[12]?
    // data[8] and data[11] seem to be the exact same value (with different conversion & thus truncation)
    // but they seem to move exactly together
    // data[12] moves differently and seems to lead vs data[8]/data[11] during cooling; lag during heating

    if (data[13] !== 0xfe) {
      // also seen: 0x00
      logUnexpectedValue(name, 13, data[13]);
    }

    if (data[14] !== 0x42) {
      logUnexpectedValue(name, 14, data[14]);
    }

    obj.runtimeMinutes = data.readUInt32BE(15);
    // runtime is at least 24 bit long data[16:19]
    // Since 24 bits is a bit odd, I'm assuming it's 32bit and join in an additional leading 0x00 at data[15]

    if (!allZero(data.subarray(19, -1))) {
      logUnexpectedValue(name, 19, data.subarray(19, -1));
    }

    return obj;
  }
}

/** Parsed energy and operational states from device response */
export class EnergyStates {
  operating = false;
  powerWatt = 0;
  energyHectoWattHour = 0;

  /** Check if payload contains energy/status data (SwiCago group 06) */
  static isEnergyStatesPayload(data: Buffer): boolean {
    if (data.length < 6) {
      return false;
    }
    return (data[1] === 0x62 || data[1] === 0x7b) && data[5] === 0x06;
  }

  /**
   * Parse energy/status states from hex payload (SwiCago group 06).
   *
   * Based on SwiCago implementation:
   * - data[3] = compressor frequency
   * - data[4] = operating status (boolean)
   *
   * @param data payload as bytes
   * @param _generalStates Optional general states for power estimation context
   */
  static parseEnergyStates(data: Buffer, _generalStates: GeneralStates | null = null): EnergyStates {
    const name = 'EnergyStates';
    logger.debug(`Parsing energy states payload: ${hex(data)}`);
    if (data.length < 12) {
      // Need at least enough bytes for data[4]
      throw new Error('EnergyStates payload too short');
    }

    if (data[0] !== 0xfc) {
      throw new Error(`EnergyStates[0] == 0x${data[0].toString(16).padStart(2, '0')} != 0xfc`);
    }

    const calculatedFcc = calcFcc(data.subarray(1, -1));
    if (calculatedFcc !== data[data.length - 1]) {
      throw new Error(
        `Invalid checksum, expected 0x${calculatedFcc.toString(16).padStart(2, '0')}, ` +
          `received 0x${data[data.length - 1].toString(16).padStart(2, '0')}`,
      );
    }

    // Verify for parts that we think are static:
    if (data[1] !== 0x62 && data[1] !== 0x7b) {
      logUnexpectedValue(name, 1, data.subarray(1, 2));
    }
    if (!bytesEqual(data.subarray(2, 5), [0x01, 0x30, 0x10])) {
      logUnexpectedValue(name, 2, data.subarray(2, 5));
    }
    if (data[5] !== 0x06) {
      throw new Error(`Not EnergyStates message: data[5] == 0x${data[5].toString(16).padStart(2, '0')} != 0x06`);
    }

    const obj = new EnergyStates();

    if (!bytesEqual(data.subarray(6, 9), [0, 0, 0])) {
      logUnexpectedValue(name, 6, data.subarray(6, 9));
    }

    obj.operating = Boolean(data[9]);
    if (data[9] !== 0 && data[9] !== 1) {
      logUnexpectedValue(name, 9, data.subarray(9, 10));
    }

    // The outdoor unit is reported as part of the first indoor unit (port A)
    // Doesn't match exactly with my power meter, but it's close.
    obj.powerWatt = data.readUInt16BE(10);
    obj.energyHectoWattHour = data.readUInt16BE(12); // in 100Wh units

    if (!bytesEqual(data.subarray(14, -1), [0, 0, 0x42, 0, 0, 0, 0])) {
      logUnexpectedValue(name, 12, data.subarray(12, -1));
    }

    return obj;
  }
}

/** Parsed error states from device response */
export class ErrorStates {
  errorCode = 0x8000;

  get isAbnormalState(): boolean {
    return this.errorCode !== 0x8000;
  }

  /** Check if payload contains error states data */
  static isErrorStatesPayload(data: Buffer): boolean {
    if (data.length < 6) {
      return false;
    }
    return (data[1] === 0x62 || data[1] === 0x7b) && data[5] === 0x04;
  }

  /** Parse error states from hex payload */
  static parseErrorStates(data: Buffer): ErrorStates {
    const name = 'ErrorStates';
    logger.debug(`Parsing error states payload: ${hex(data)}`);
    if (data.length < 11) {
      throw new Error('ErrorStates payload too short');
    }

    if (data[0] !== 0xfc) {
      throw new Error(`ErrorStates[0] == 0x${data[0].toString(16).padStart(2, '0')} != 0xfc`);
    }

    const calculatedFcc = calcFcc(data.subarray(1, -1));
    if (calculatedFcc !== data[data.length - 1]) {
      throw new Error(
        `Invalid checksum, expected 0x${calculatedFcc.toString(16).padStart(2, '0')}, ` +
          `received 0x${data[data.length - 1].toString(16).padStart(2, '0')}`,
      );
    }

    // Verify for parts that we think are static:
    if (data[1] !== 0x62 && data[1] !== 0x7b) {
      logUnexpectedValue(name, 1, data.subarray(1, 2));
    }
    if (!bytesEqual(data.subarray(2, 5), [0x01, 0x30, 0x10])) {
      logUnexpectedValue(name, 2, data.subarray(2, 5));
    }
    if (data[5] !== 0x04) {
      throw new Error(`Not ErrorStates message: data[5] == 0x${data[5].toString(16).padStart(2, '0')} != 0x04`);
    }

    const obj = new ErrorStates();

    if (!bytesEqual(data.subarray(6, 9), [0, 0, 0])) {
      logUnexpectedValue(name, 6, data.subarray(6, 9));
    }

    obj.errorCode = data.readUInt16BE(9);

    if (!allZero(data.subarray(11, -1))) {
      logUnexpectedValue(name, 11, data.subarray(11, -1));
    }

    return obj;
  }
}

export class Unknown5States {
  /** Check if payload contains unknown-5 states data */
  static isUnknown5StatesPayload(data: Buffer): boolean {
    if (data.length < 6) {
      return false;
    }
    return (data[1] === 0x62 || data[1] === 0x7b) && data[5] === 0x05;
  }

  static parseUnknown5States(data: Buffer): Unknown5States {
    const name = 'Unknown5States';
    logger.debug(`Parsing ${name} payload: ${hex(data)}`);
    if (data.length < 6) {
      throw new Error(`${name} payload too short`);
    }

    if (data[0] !== 0xfc) {
      throw new Error(`${name}[0] == 0x${data[0].toString(16).padStart(2, '0')} != 0xfc`);
    }

    const calculatedFcc = calcFcc(data.subarray(1, -1));
    if (calculatedFcc !== data[data.length - 1]) {
      throw new Error(
        `Invalid checksum, expected 0x${calculatedFcc.toString(16).padStart(2, '0')}, ` +
          `received 0x${data[data.length - 1].toString(16).padStart(2, '0')}`,
      );
    }

    // Verify for parts that we think are static:
    if (data[1] !== 0x62 && data[1] !== 0x7b) {
      logUnexpectedValue(name, 1, data.subarray(1, 2));
    }
    if (!bytesEqual(data.subarray(2, 5), [0x01, 0x30, 0x10])) {
      logUnexpectedValue(name, 2, data.subarray(2, 5));
    }
    if (data[5] !== 0x05) {
      throw new Error(`Not ${name} message: data[5] == 0x${data[5].toString(16).padStart(2, '0')} != 0x05`);
    }

    const obj = new Unknown5States();

    if (!allZero(data.subarray(6, -1))) {
      logUnexpectedValue(name, 6, data.subarray(6, -1));
    }

    return obj;
  }
}

export class AutoStates {
  powerMode = 0;
  autoMode: AutoMode = AutoMode.OFF;

  /** Check if payload contains auto states data */
  static isAutoStatesPayload(data: Buffer): boolean {
    if (data.length < 6) {
      return false;
    }
    return (data[1] === 0x62 || data[1] === 0x7b) && data[5] === 0x09;
  }

  static parseUnknown9States(data: Buffer): AutoStates {
    const name = 'AutoStates';
    logger.debug(`Parsing ${name} payload: ${hex(data)}`);
    if (data.length < 6) {
      throw new Error(`${name} payload too short`);
    }

    if (data[0] !== 0xfc) {
      throw new Error(`${name}[0] == 0x${data[0].toString(16).padStart(2, '0')} != 0xfc`);
    }

    const calculatedFcc = calcFcc(data.subarray(1, -1));
    if (calculatedFcc !== data[data.length - 1]) {
      throw new Error(
        `Invalid checksum, expected 0x${calculatedFcc.toString(16).padStart(2, '0')}, ` +
          `received 0x${data[data.length - 1].toString(16).padStart(2, '0')}`,
      );
    }

    // Verify for parts that we think are static:
    if (data[1] !== 0x62 && data[1] !== 0x7b) {
      logUnexpectedValue(name, 1, data.subarray(1, 2));
    }
    if (!bytesEqual(data.subarray(2, 5), [0x01, 0x30, 0x10])) {
      logUnexpectedValue(name, 2, data.subarray(2, 5));
    }
    if (data[5] !== 0x09) {
      throw new Error(`Not ${name} message: data[5] == 0x${data[5].toString(16).padStart(2, '0')} != 0x09`);
    }

    const obj = new AutoStates();

    if (!bytesEqual(data.subarray(6, 8), [0, 0])) {
      logUnexpectedValue(name, 6, data.subarray(6, 9));
    }

    if (data[8] !== 0) {
      // observed 0x04 during auto-mode heating startup
      // "switching pump direction" or something?
      // 0x08 also reported
      logUnexpectedValue(name, 8, data[8]);
    }

    obj.powerMode = data[9];
    // This seems demand-related.
    // It's 0 when off, and goes up to 6 (?)
    // On but not pumping is 1 (operating in Energy turns to 0 in this case)
    // Higher seems to indicate higher demand

    obj.autoMode = tryEnumOrLog(name, 10, data[10], enumValues(AutoMode));

    if (!allZero(data.subarray(11, -1))) {
      logUnexpectedValue(name, 10, data.subarray(10, -1));
    }

    return obj;
  }
}

/** Complete parsed device state combining all state types */
export class ParsedDeviceState {
  general: GeneralStates | null = null;
  sensors: SensorStates | null = null;
  errors: ErrorStates | null = null;
  energy: EnergyStates | null = null; // New energy/operational data
  autoState: AutoStates | null = null;
  mac = '';
  serial = '';
  rssi = '';
  appVersion = '';

  _unknown5: Unknown5States | null = null;

  /** Parse a list of code values and return combined device state with energy information */
  static parseCodeValues(codeValues: string[]): ParsedDeviceState {
    const parsedState = new ParsedDeviceState();
    logger.debug(`Parsing ${codeValues.length} code values`);

    for (const hexValue of codeValues) {
      const value = Buffer.from(hexValue, 'hex');

      try {
        // Parse different payload types
        if (GeneralStates.isGeneralStatesPayload(value)) {
          parsedState.general = GeneralStates.parseGeneralStates(value);
        } else if (SensorStates.isSensorStatesPayload(value)) {
          parsedState.sensors = SensorStates.parseSensorStates(value);
        } else if (ErrorStates.isErrorStatesPayload(value)) {
          parsedState.errors = ErrorStates.parseErrorStates(value);
        } else if (EnergyStates.isEnergyStatesPayload(value)) {
          // Parse energy states with context from general states if available
          parsedState.energy = EnergyStates.parseEnergyStates(value, parsedState.general);
        } else if (Unknown5States.isUnknown5StatesPayload(value)) {
          parsedState._unknown5 = Unknown5States.parseUnknown5States(value);
        } else if (AutoStates.isAutoStatesPayload(value)) {
          parsedState.autoState = AutoStates.parseUnknown9States(value);
        } else {
          logger.debug(`Ignoring unknown code value: ${hex(value)}`);
        }
      } catch (e) {
        if (e instanceof Error) {
          logger.warning(`Failed to parse code value: ${e.message}\n${hex(value)}`);
        } else {
          throw e;
        }
      }
    }

    return parsedState;
  }
}

export class SetRemoteTemperature {
  mode: SetRemoteTemperatureMode = SetRemoteTemperatureMode.UseInternal;
  remoteTemperature: number | null = null;

  static temperatureToLegacy(temp: number): number {
    if (temp < 16) {
      temp = 16;
    }
    if (temp > 31.5) {
      temp = 31.5;
    }

    let wire = (31 - Math.trunc(temp)) & 0xf;

    if (temp % 1 >= 0.5) {
      wire |= 0x10;
    }

    return wire;
  }

  static temperatureToEnhanced(temp: number): number {
    return Math.trunc(temp * 2 + 0x80);
  }

  generateCommand(): Buffer {
    const cmd = Buffer.alloc(8);
    Buffer.from([0x41, 0x01, 0x30, 0x10, 0x07]).copy(cmd);

    cmd[5] = this.mode;
    cmd[6] = this.remoteTemperature !== null ? SetRemoteTemperature.temperatureToLegacy(this.remoteTemperature) : 0x00;
    cmd[7] =
      this.remoteTemperature !== null ? SetRemoteTemperature.temperatureToEnhanced(this.remoteTemperature) : 0x00;

    // Calculate and append FCC
    const fcc = calcFcc(cmd);
    return Buffer.concat([Buffer.from([0xfc]), cmd, Buffer.from([fcc])]);
  }
}


/** Calculate FCC checksum for Mitsubishi protocol payload */
export function calcFcc(payload: Buffer): number {
  // TODO: do we actually need to limit this to 20 bytes?
  let sum = 0;
  for (let i = 0; i < Math.min(20, payload.length); i++) {
    sum += payload[i];
  }
  return (0x100 - (sum % 0x100)) % 0x100;
}

/** Convert temperature in 0.1°C units to segment format */
export function convertTemperature(temperature: number): string {
  const t = Math.max(16, Math.min(31, temperature));
  const e = 31 - Math.trunc(t);
  const lastDigit = String(t).slice(-1) === '0' ? '0' : '1';
  return lastDigit + e.toString(16);
}

/** Convert temperature to segment 14 format */
export function convertTemperatureToSegment(temperature: number): string {
  const value = 0x80 + Math.floor(temperature / 0.5);
  return Math.trunc(value).toString(16).padStart(2, '0');
}

/** Normalize temperature from hex value to 0.1°C units */
export function getNormalizedTemperature(hexValue: number): number {
  const adjusted = 5 * (hexValue - 0x80);
  if (adjusted >= 400) {
    return 400;
  } else if (adjusted <= 0) {
    return 0;
  }
  return adjusted;
}
