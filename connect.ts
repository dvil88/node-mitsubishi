/**
 * Simple script: connect to a Mitsubishi AC and print its current state.
 *
 * Usage:
 *   npm run build && node dist/connect.js [host:port]
 */

import {logger, MitsubishiAPI} from './mitsubishi_api';
import {
    DriveMode,
    HorizontalWindDirection,
    ParsedDeviceState,
    PowerOnOff,
    RemoteLock,
    VerticalWindDirection,
    WindSpeed,
} from './mitsubishi_parser';
import {MitsubishiController} from "./mitsubishi_controller";

const DEVICE_HOST_PORT = process.argv[2];
logger.level = 'info';

const api = new MitsubishiAPI(DEVICE_HOST_PORT, undefined, undefined, undefined,);
console.log(`Connecting to ${DEVICE_HOST_PORT} ...`);
const controller = new MitsubishiController(api);

async function main(): Promise<void> {
    try {
        // Unit info comes from the (unencrypted) /unitinfo endpoint using admin creds.
        const unitInfo = await api.getUnitInfo();
        console.log('\nUnit info:');
        for (const [section, fields] of Object.entries(unitInfo)) {
            console.log(`  [${section}]`);
            for (const [key, value] of Object.entries(fields)) {
                console.log(`    ${key}: ${value}`);
            }
        }

        const status = await controller.fetchStatus();
        await showStatus(status);

        // const newStatus = await controller.setPower(true);
        // const newStatus = await controller.setMode(DriveMode.COOLER);
        // const newStatus = await controller.setTemperature(25);
        // const newStatus = await controller.setDehumidifier(50);
        // const newStatus = await controller.setFanSpeed(WindSpeed.AUTO);
        // const newStatus = await controller.setVerticalVane(VerticalWindDirection.SWING);
        // const newStatus = await controller.setHorizontalVane(HorizontalWindDirection.SWING);
        // const newStatus = await controller.setPowerSaving(true);
        // await showStatus(newStatus);
    } catch (e) {
        console.error(`\nFailed to connect: ${e instanceof Error ? e.message : String(e)}`);
        process.exitCode = 1;
    } finally {
        api.close();
    }
}

async function showStatus(status: ParsedDeviceState | null): Promise<void> {
    if (status === null) {
        return;
    }

    if (status.general) {
        const g = status.general;
        console.log('\nGeneral:');
        console.log(`  Power : ${PowerOnOff[g.powerOnOff] ?? g.powerOnOff}`);
        console.log(`  Mode : ${DriveMode[g.driveMode] ?? g.driveMode}`);
        console.log(`  Target temp : ${g.temperature} °C`);
        console.log(`  Fine temp : ${g.fineTemperature} °C`);
        console.log(`  Fan speed : ${WindSpeed[g.windSpeed] ?? g.windSpeed}`);
        console.log(`  Vertical wind direction : ${VerticalWindDirection[g.verticalWindDirection]}`);
        console.log(`  Horizontal wind direction : ${HorizontalWindDirection[g.horizontalWindDirection]}`);
        console.log(`  Remote lock : ${RemoteLock[g.remoteLock]}`);
        console.log(`  Dehum setting : ${g.dehumSetting}`);
        console.log(`  Is power saving : ${g.isPowerSaving}`);
        console.log(`  Wind and wind break direct : ${g.windAndWindBreakDirect}`);
        console.log(`  I see sensor : ${g.iSeeSensor}`);
        console.log(`  Wide vane adjustment : ${g.wideVaneAdjustment}`);
    }
    if (status.sensors) {
        console.log('\nSensors:');
        console.log(`  Room temp : ${status.sensors.roomTemperature} °C`);
        console.log(`  Outside temp : ${status.sensors.outsideTemperature} °C`);
        console.log(`  Runtime minutes : ${status.sensors.runtimeMinutes} min`);
    }
    if (status.energy) {
        console.log('\nEnergy:');
        console.log(`  Operating : ${status.energy.operating}`);
        console.log(`  Power : ${status.energy.powerWatt} W`);
        console.log(`  Energy hWh : ${status.energy.energyHectoWattHour} hWh`);
        console.log(`  Energy Wh : ${status.energy.energyHectoWattHour * 100} Wh`);
        console.log(`  Energy kWh : ${status.energy.energyHectoWattHour / 10} kWh`);
    }
    if (status.errors) {
        console.log('\nErrors:');
        console.log(`  Abnormal : ${status.errors.isAbnormalState}`);
        console.log(`  Error code : 0x${status.errors.errorCode.toString(16)}`);
    }
}

void main();
