# NodeMitsubishi

A TypeScript / Node.js port of [**pymitsubishi**](https://github.com/pymitsubishi/pymitsubishi), a library for
controlling and monitoring Mitsubishi MAC-577IF-2E Wi-Fi air-conditioner adaptors over the local network.

All protocol logic (payload parsing, AES-CBC encryption, control commands) is a faithful port of the original
Python project. Credit for the reverse-engineering and protocol work goes to the
[pymitsubishi](https://github.com/pymitsubishi/pymitsubishi) authors.

## Requirements

- Node.js 18+ (uses the built-in `node:crypto` and `node:http` — no runtime dependencies)

## Install & build

```bash
npm install      # dev dependencies (TypeScript, @types/node)
npm run build    # compile to dist/
```

Other scripts:

```bash
npm run typecheck   # type-check without emitting
npm run connect     # build and run the example connect script (see connect.ts)
```

## Usage

```ts
import { MitsubishiController } from './mitsubishi_controller';
import { DriveMode, WindSpeed } from './mitsubishi_parser';

const controller = MitsubishiController.create('192.168.1.100'); // host[:port]

// Read current state
const state = await controller.fetchStatus();
console.log(state.general?.temperature, state.sensors?.roomTemperature);

// Change settings
await controller.setPower(true);
await controller.setMode(DriveMode.COOLER);
await controller.setTemperature(24);
await controller.setFanSpeed(WindSpeed.S2);

controller.api.close();
```

By default the controller uses the `unregistered` static key. Pass a device-specific key as the second argument
to `MitsubishiController.create(host, key)` if your unit requires one.

## Project layout

| File | Purpose |
| --- | --- |
| `mitsubishi_parser.ts` | Protocol payload parsing, enums, state classes, command generation |
| `mitsubishi_api.ts` | HTTP communication, AES-CBC (ISO 7816-4) encryption/decryption, XML handling |
| `mitsubishi_controller.ts` | Business-logic layer: fetch status, build change sets, send commands |
| `helpers/` | Shared utilities — `bytes`, `iso7816` padding, `logger`, `xml` |

## Notes

- The device's HTTP stack is case-sensitive on header names and rejects chunked request bodies, so requests are
  sent via `node:http` (which preserves header casing) with an explicit `Content-Length`.
- Network methods are asynchronous (`Promise`-based), unlike the synchronous Python original.

## Credits

Ported from [pymitsubishi/pymitsubishi](https://github.com/pymitsubishi/pymitsubishi).

## License

MIT License - see LICENSE file for details.
