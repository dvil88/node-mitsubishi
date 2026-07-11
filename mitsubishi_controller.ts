/**
 * Mitsubishi Air Conditioner Business Logic Layer
 *
 * This module is responsible for managing control operations and state
 * for Mitsubishi MAC-577IF-2E devices.
 */

import { MitsubishiAPI, logger } from './mitsubishi_api';
import {
  Controls,
  Controls08,
  DriveMode,
  GeneralStates,
  HorizontalWindDirection,
  ParsedDeviceState,
  PowerOnOff,
  RemoteLock,
  SetRemoteTemperature,
  SetRemoteTemperatureMode,
  VerticalWindDirection,
  WindSpeed,
} from './mitsubishi_parser';
import { allValues, firstTagText, tagInner } from './helpers/xml';

/** Overrides accepted by {@link MitsubishiController.createUpdatedState}. */
export interface GeneralStateOverrides {
  powerOnOff?: PowerOnOff;
  temperature?: number;
  driveMode?: DriveMode;
  windSpeed?: WindSpeed;
  verticalWindDirection?: VerticalWindDirection;
  horizontalWindDirection?: HorizontalWindDirection;
  dehumSetting?: number;
  isPowerSaving?: boolean;
  windAndWindBreakDirect?: number;
  remoteLock?: RemoteLock;
}

export class MitsubishiChangeSet {
  desiredState: GeneralStates;
  changes: Controls;
  changes08: Controls08;

  constructor(currentState: GeneralStates) {
    this.desiredState = currentState;
    this.changes = Controls.NoControl;
    this.changes08 = Controls08.NoControl;
  }

  get empty(): boolean {
    return this.changes === Controls.NoControl && this.changes08 === Controls08.NoControl;
  }

  setPower(power: PowerOnOff): void {
    this.desiredState.powerOnOff = power;
    this.changes |= Controls.PowerOnOff;
  }

  setMode(driveMode: DriveMode): void {
    const modeValue = driveMode === DriveMode.AUTO ? 8 : driveMode;
    this.desiredState.driveMode = modeValue as DriveMode;
    this.changes |= Controls.DriveMode;
  }

  setTemperature(temperature: number): void {
    this.desiredState.temperature = temperature;
    this.changes |= Controls.Temperature;
  }

  setDehumidifier(humidity: number): void {
    this.desiredState.dehumSetting = humidity;
    this.changes08 |= Controls08.Dehum;
  }

  setFanSpeed(fanSpeed: WindSpeed): void {
    this.desiredState.windSpeed = fanSpeed;
    this.changes |= Controls.WindSpeed;
  }

  setVerticalVane(vVane: VerticalWindDirection): void {
    this.desiredState.verticalWindDirection = vVane;
    this.changes |= Controls.UpDownWindDirection;
  }

  setHorizontalVane(hVane: HorizontalWindDirection): void {
    this.desiredState.horizontalWindDirection = hVane;
    this.changes |= Controls.LeftRightWindDirect;
  }

  setPowerSaving(powerSaving: boolean): void {
    this.desiredState.isPowerSaving = powerSaving;
    this.changes08 |= Controls08.PowerSaving;
  }
}

/** Business logic controller for Mitsubishi AC devices */
export class MitsubishiController {
  // Number of seconds after a command that the result is visible in the returned status.
  // Found experimentally by increasing until updates reliably showed up.
  static readonly waitTimeAfterCommand = 5;

  readonly api: MitsubishiAPI;
  profileCode: Buffer[] = [];
  state: ParsedDeviceState | null = null;
  unitInfo: Record<string, Record<string, string | number>> = {};

  constructor(api: MitsubishiAPI) {
    this.api = api;
  }

  /** Create a MitsubishiController with the specified host:port and encryption key */
  static create(deviceHostPort: string, encryptionKey: string | Buffer = 'unregistered'): MitsubishiController {
    const api = new MitsubishiAPI(deviceHostPort, encryptionKey);
    return new MitsubishiController(api);
  }

  /** Fetch current device status and optionally detect capabilities */
  async fetchStatus(): Promise<ParsedDeviceState> {
    const response = await this.api.sendStatusRequest(); // may raise
    return this.parseStatusResponse(response);
  }

  /** Parse the device status response and update state */
  private parseStatusResponse(response: string): ParsedDeviceState {
    // Extract code values for parsing (VALUE nodes directly under CODE)
    const codeInner = tagInner(response, 'CODE');
    const codeValues = codeInner ? allValues(codeInner) : [];

    // Use the parser module to get structured state
    this.state = ParsedDeviceState.parseCodeValues(codeValues);

    // Extract and set device identity
    const mac = firstTagText(response, 'MAC');
    if (mac !== null) {
      this.state.mac = mac;
    }

    const serial = firstTagText(response, 'SERIAL');
    if (serial !== null) {
      this.state.serial = serial;
    }

    // Prefer PROFILECODE/DATA/VALUE, falling back to PROFILECODE/VALUE
    const profileInner = tagInner(response, 'PROFILECODE');
    this.profileCode = [];
    if (profileInner !== null) {
      const dataInner = tagInner(profileInner, 'DATA');
      const profileValues = dataInner !== null ? allValues(dataInner) : allValues(profileInner);
      for (const text of profileValues) {
        this.profileCode.push(Buffer.from(text, 'hex'));
      }
    }

    return this.state;
  }

  private async ensureStateAvailable(): Promise<void> {
    if (this.state === null || this.state.general === null) {
      await this.fetchStatus();
    }
  }

  async changeset(): Promise<MitsubishiChangeSet> {
    await this.ensureStateAvailable();
    if (this.state === null || this.state.general === null) {
      throw new Error('Failed to fetch device state');
    }
    return new MitsubishiChangeSet(this.state.general);
  }

  async applyChangeset(cs: MitsubishiChangeSet): Promise<ParsedDeviceState | null> {
    let newState: ParsedDeviceState | null = null;

    if (cs.changes !== Controls.NoControl) {
      newState = await this.sendGeneralControlCommand(cs.desiredState, cs.changes);
    }

    if (cs.changes08 !== Controls08.NoControl) {
      newState = await this.sendExtend08Command(cs.desiredState, cs.changes08);
    }

    return newState;
  }

  /** Create updated state with specified field overrides */
  private createUpdatedState(overrides: GeneralStateOverrides): GeneralStates {
    const base = this.state?.general;
    const g = new GeneralStates();

    if (!base) {
      // No existing state: apply overrides on top of defaults
      if (overrides.powerOnOff !== undefined) g.powerOnOff = overrides.powerOnOff;
      if (overrides.temperature !== undefined) g.temperature = overrides.temperature;
      if (overrides.driveMode !== undefined) g.driveMode = overrides.driveMode;
      if (overrides.windSpeed !== undefined) g.windSpeed = overrides.windSpeed;
      if (overrides.verticalWindDirection !== undefined) g.verticalWindDirection = overrides.verticalWindDirection;
      if (overrides.horizontalWindDirection !== undefined) g.horizontalWindDirection = overrides.horizontalWindDirection;
      if (overrides.dehumSetting !== undefined) g.dehumSetting = overrides.dehumSetting;
      if (overrides.isPowerSaving !== undefined) g.isPowerSaving = overrides.isPowerSaving;
      if (overrides.windAndWindBreakDirect !== undefined) g.windAndWindBreakDirect = overrides.windAndWindBreakDirect;
      if (overrides.remoteLock !== undefined) g.remoteLock = overrides.remoteLock;
      return g;
    }

    const temperature = overrides.temperature ?? base.temperature;
    g.powerOnOff = overrides.powerOnOff ?? base.powerOnOff;
    g.coarseTemperature = Math.trunc(temperature);
    g.fineTemperature = temperature;
    g.driveMode = overrides.driveMode ?? base.driveMode;
    g.windSpeed = overrides.windSpeed ?? base.windSpeed;
    g.verticalWindDirection = overrides.verticalWindDirection ?? base.verticalWindDirection;
    g.horizontalWindDirection = overrides.horizontalWindDirection ?? base.horizontalWindDirection;
    g.dehumSetting = overrides.dehumSetting ?? base.dehumSetting;
    g.isPowerSaving = overrides.isPowerSaving ?? base.isPowerSaving;
    g.windAndWindBreakDirect = overrides.windAndWindBreakDirect ?? base.windAndWindBreakDirect;
    g.remoteLock = overrides.remoteLock ?? base.remoteLock;
    return g;
  }

  async setPower(powerOn: boolean): Promise<ParsedDeviceState | null> {
    const cs = await this.changeset();
    cs.setPower(powerOn ? PowerOnOff.ON : PowerOnOff.OFF);
    return this.applyChangeset(cs);
  }

  async setTemperature(temperatureCelsius: number): Promise<ParsedDeviceState | null> {
    const cs = await this.changeset();
    cs.setTemperature(temperatureCelsius);
    return this.applyChangeset(cs);
  }

  async setCurrentTemperature(temperatureCelsius: number | null): Promise<void> {
    const cmd = new SetRemoteTemperature();
    if (temperatureCelsius === null) {
      cmd.mode = SetRemoteTemperatureMode.UseInternal;
    } else {
      cmd.mode = SetRemoteTemperatureMode.RemoteTemp;
      cmd.remoteTemperature = temperatureCelsius;
    }
    const command = cmd.generateCommand();
    const response = await this.api.sendCommand(command);
    this.state = this.parseStatusResponse(response);
  }

  async setMode(mode: DriveMode): Promise<ParsedDeviceState | null> {
    const cs = await this.changeset();
    cs.setMode(mode);
    return this.applyChangeset(cs);
  }

  async setFanSpeed(speed: WindSpeed): Promise<ParsedDeviceState | null> {
    const cs = await this.changeset();
    cs.setFanSpeed(speed);
    return this.applyChangeset(cs);
  }

  async setVerticalVane(direction: VerticalWindDirection): Promise<ParsedDeviceState | null> {
    const cs = await this.changeset();
    cs.setVerticalVane(direction);
    return this.applyChangeset(cs);
  }

  async setHorizontalVane(direction: HorizontalWindDirection): Promise<ParsedDeviceState | null> {
    const cs = await this.changeset();
    cs.setHorizontalVane(direction);
    return this.applyChangeset(cs);
  }

  async setDehumidifier(setting: number): Promise<ParsedDeviceState | null> {
    const cs = await this.changeset();
    cs.setDehumidifier(setting);
    return this.applyChangeset(cs);
  }

  async setPowerSaving(enabled: boolean): Promise<ParsedDeviceState | null> {
    const cs = await this.changeset();
    cs.setPowerSaving(enabled);
    return this.applyChangeset(cs);
  }

  /** Send buzzer control command */
  async sendBuzzerCommand(enabled = true): Promise<ParsedDeviceState> {
    void enabled;
    await this.ensureStateAvailable();
    const generalState = this.state?.general ?? new GeneralStates();
    const newState = await this.sendExtend08Command(generalState, Controls08.Buzzer);
    this.state = newState;
    return newState;
  }

  async setRemoteLock(lock: RemoteLock): Promise<ParsedDeviceState> {
    await this.ensureStateAvailable();

    const updatedState = this.createUpdatedState({ remoteLock: lock });
    const newState = await this.sendGeneralControlCommand(updatedState, Controls.RemoteLock);
    this.state = newState;
    return newState;
  }

  /** Send a general control command to the device */
  private async sendGeneralControlCommand(state: GeneralStates, controls: Controls): Promise<ParsedDeviceState> {
    // Generate the hex command
    const hexCommand = state.generateGeneralCommand(controls).toString('hex');
    const response = await this.api.sendHexCommand(hexCommand);
    return this.parseStatusResponse(response);
  }

  /** Send an extend08 command for advanced features */
  private async sendExtend08Command(state: GeneralStates, controls: Controls08): Promise<ParsedDeviceState> {
    // Generate the hex command
    const hexCommand = state.generateExtend08Command(controls).toString('hex');
    const response = await this.api.sendHexCommand(hexCommand);
    return this.parseStatusResponse(response);
  }

  /** Send ECHONET enable command */
  async enableEchonet(): Promise<void> {
    await this.api.sendEchonetEnable();
  }

  /** Get detailed unit information from the admin interface */
  async getUnitInfo(): Promise<Record<string, Record<string, string | number>>> {
    this.unitInfo = await this.api.getUnitInfo();
    logger.debug(
      `✅ Unit info retrieved: ` +
        `${Object.keys(this.unitInfo['Adaptor Information'] ?? {}).length} adaptor fields, ` +
        `${Object.keys(this.unitInfo['Unit Info'] ?? {}).length} unit fields`,
    );
    return this.unitInfo;
  }
}
