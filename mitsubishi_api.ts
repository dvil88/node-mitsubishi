/**
 * Mitsubishi Air Conditioner API Communication Layer
 *
 * This module handles all HTTP communication, encryption, and decryption
 * for Mitsubishi MAC-577IF-2E devices.
 */

import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { getRootText } from './helpers/xml';
import { padIso7816, unpadIso7816 } from './helpers/iso7816';
import { createLogger } from './helpers/logger';

export const logger = createLogger('mitsubishi_api');

// Constants from the working implementation
const KEY_SIZE = 16;
const STATIC_KEY = Buffer.from('unregistered\0\0\0\0', 'binary'); // Use bytes directly with proper padding

export type UnitInfo = Record<string, Record<string, string | number>>;


/** Handles all API communication with Mitsubishi AC devices */
export class MitsubishiAPI {
    readonly deviceHostPort: string;
    readonly encryptionKey: Buffer;
    readonly adminUsername: string;
    readonly adminPassword: string;

    private readonly agent = new http.Agent({keepAlive: true});

    constructor(
        deviceHostPort: string,
        encryptionKey: Buffer | string = STATIC_KEY,
        adminUsername = 'admin',
        adminPassword = 'me1debug@0567',
    ) {
        this.deviceHostPort = deviceHostPort;

        // Handle both bytes and string encryption keys
        let key = typeof encryptionKey === 'string' ? Buffer.from(encryptionKey, 'utf-8') : encryptionKey;
        // Ensure key is exactly KEY_SIZE bytes
        if (key.length < KEY_SIZE) {
            key = Buffer.concat([key, Buffer.alloc(KEY_SIZE - key.length, 0)]); // pad with NULL-bytes
        }
        this.encryptionKey = key.subarray(0, KEY_SIZE); // trim if too long

        this.adminUsername = adminUsername;
        this.adminPassword = adminPassword;
    }

    /** Get the crypto key - now just returns the properly sized key */
    getCryptoKey(): Buffer {
        return this.encryptionKey;
    }

    /** Encrypt payload using AES-CBC with proper padding */
    encryptPayload(payload: string, iv: Buffer | null = null): string {
        if (iv === null) {
            // Allow passing in IV for testing purposes
            iv = crypto.randomBytes(KEY_SIZE);
        }

        // Encrypt using AES CBC with ISO 7816-4 padding
        const cipher = crypto.createCipheriv('aes-128-cbc', this.encryptionKey, iv);
        cipher.setAutoPadding(false);

        const payloadBytes = Buffer.from(payload, 'utf-8');
        const paddedPayload = padIso7816(payloadBytes, KEY_SIZE);

        const encrypted = Buffer.concat([cipher.update(paddedPayload), cipher.final()]);

        // Combine IV and encrypted data, then base64 encode
        return Buffer.concat([iv, encrypted]).toString('base64');
    }

    decryptPayload(payloadB64: string): string {
        logger.debug(`Base64 payload length: ${payloadB64.length}`);

        // Convert base64 directly to bytes
        const encrypted = Buffer.from(payloadB64, 'base64'); // may produce garbage on bad input

        // Extract IV and encrypted data
        const iv = encrypted.subarray(0, KEY_SIZE);
        const encryptedData = encrypted.subarray(KEY_SIZE);

        logger.debug(`IV: ${iv.toString('hex')}`);
        logger.debug(`Encrypted data length: ${encryptedData.length}`);

        // Decrypt using AES CBC
        const decipher = crypto.createDecipheriv('aes-128-cbc', this.encryptionKey, iv);
        decipher.setAutoPadding(false);
        const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]); // may raise, e.g. when invalid length

        logger.debug(`Decrypted raw length: ${decrypted.length}`);

        // Try to remove ISO 7816-4 padding first
        let decryptedClean: Buffer;
        try {
            decryptedClean = unpadIso7816(decrypted, KEY_SIZE);
        } catch {
            // Fall back to removing zero padding if ISO padding fails
            logger.debug('ISO 7816-4 unpadding failed, using zero padding removal');
            let end = decrypted.length;
            while (end > 0 && decrypted[end - 1] === 0x00) {
                end--;
            }
            decryptedClean = decrypted.subarray(0, end);
        }

        logger.debug(`After padding removal length: ${decryptedClean.length}`);

        // Try to decode as UTF-8 (strictly, so invalid bytes are detectable)
        try {
            const result = new TextDecoder('utf-8', {fatal: true}).decode(decryptedClean);
            logger.debug(`Decrypted XML response: ${result}`);
            return result;
        } catch {
            logger.debug('UTF-8 decode error');

            // Try to find the actual end of the XML by looking for closing tags
            const xmlEndPatterns = ['</LSV>', '</CSV>', '</ESV>'];
            for (const pattern of xmlEndPatterns) {
                const patternBuf = Buffer.from(pattern, 'utf-8');
                const pos = decryptedClean.indexOf(patternBuf);
                if (pos !== -1) {
                    const endPos = pos + patternBuf.length;
                    const truncated = decryptedClean.subarray(0, endPos);
                    logger.debug(`Found XML end pattern ${pattern} at position ${pos}`);
                    try {
                        return new TextDecoder('utf-8', {fatal: true}).decode(truncated);
                    } catch {
                    }
                }
            }

            // If no valid XML end found, decode leniently (invalid bytes replaced)
            const fallbackResult = new TextDecoder('utf-8').decode(decryptedClean);
            logger.debug(`Using lenient decode, result length: ${fallbackResult.length}`);
            return fallbackResult;
        }
    }

    /** Make HTTP request to the /smart endpoint */
    async makeRequest(payloadXml: string): Promise<string> {
        logger.debug('Payload xml:');
        logger.debug(payloadXml);

        // Encrypt the XML payload
        const encryptedPayload = this.encryptPayload(payloadXml);

        // Create the full XML request body
        const requestBody = `<?xml version="1.0" encoding="UTF-8"?><ESV>${encryptedPayload}</ESV>`;

        logger.debug('Request Body:');
        logger.debug(requestBody);

        const headers: Record<string, string> = {
            'Host': `${this.deviceHostPort}`,
            'Content-Type': 'text/plain;chrset=UTF-8',
            'Connection': 'keep-alive',
            'Proxy-Connection': 'keep-alive',
            'Accept': '*/*',
            'User-Agent': 'KirigamineRemote/5.1.0 (jp.co.MitsubishiElectric.KirigamineRemote; build:3; iOS 17.5.1) Alamofire/5.9.1',
            'Accept-Language': 'zh-Hant-JP;q=1.0, ja-JP;q=0.9',
        };

        const url = `http://${this.deviceHostPort}/smart`;

        const {statusCode, body} = await this.httpRequest('POST', url, headers, requestBody);
        if (statusCode >= 400) {
            throw new Error(`HTTP ${statusCode} for ${url}`);
        }

        const text = body.toString('utf-8');
        logger.debug('Response Text:');
        logger.debug(text);

        const encryptedResponse = getRootText(text);
        if (encryptedResponse) {
            return this.decryptPayload(encryptedResponse);
        }
        throw new Error('Could not find any text in response');
    }

    sendRebootRequest(): Promise<string> {
        return this.makeRequest('<CSV><RESET></RESET></CSV>');
    }

    /** Send a status request to get current device state */
    sendStatusRequest(): Promise<string> {
        const payloadXml = '<CSV><CONNECT>ON</CONNECT></CSV>';
        return this.makeRequest(payloadXml);
    }

    /** Send ECHONET enable command */
    sendEchonetEnable(): Promise<string> {
        const payloadXml = '<CSV><CONNECT>ON</CONNECT><ECHONET>ON</ECHONET></CSV>';
        return this.makeRequest(payloadXml);
    }

    sendCommand(command: Buffer): Promise<string> {
        return this.sendHexCommand(command.toString('hex'));
    }

    sendHexCommand(hexCommand: string): Promise<string> {
        logger.debug(`🔧 Sending command: ${hexCommand}`);
        const payloadXml = `<CSV><CONNECT>ON</CONNECT><CODE><VALUE>${hexCommand}</VALUE></CODE></CSV>`;
        return this.makeRequest(payloadXml);
    }

    async getUnitInfo(): Promise<UnitInfo> {
        const url = `http://${this.deviceHostPort}/unitinfo`;
        const auth = 'Basic ' + Buffer.from(`${this.adminUsername}:${this.adminPassword}`).toString('base64');
        logger.debug(`Fetching unit info from ${url}`);

        const {statusCode, body} = await this.httpRequest('GET', url, {Host: this.deviceHostPort, Authorization: auth});
        if (statusCode >= 400) {
            throw new Error(`HTTP ${statusCode} for ${url}`);
        }

        const text = body.toString('utf-8');
        logger.debug(`Unit info HTML response received (${text.length} chars)`);

        return MitsubishiAPI.parseUnitInfoHtml(text);
    }

    static parseUnitInfoHtml(htmlContent: string): UnitInfo {
        const unitInfo: UnitInfo = {};
        let section = '';
        const pattern = /<(div) class="titleA">([^<]*)<\/div>|<(dt)>([^<]+)<\/dt>\s*<dd>([^<]+)<\/dd>/g;

        for (const match of htmlContent.matchAll(pattern)) {
            if (match[1] === 'div') {
                section = match[2] ?? '';
                if (!(section in unitInfo)) {
                    unitInfo[section] = {};
                }
            } else if (match[3] === 'dt') {
                unitInfo[section][match[4]] = match[5];
            } else {
                throw new Error('Unexpected regex match');
            }
        }

        const adaptor = unitInfo['Adaptor Information'];
        if (adaptor && adaptor['Channel'] !== undefined) {
            adaptor['Channel'] = parseInt(String(adaptor['Channel']), 10);
        }
        if (adaptor && adaptor['RSSI'] !== undefined) {
            adaptor['RSSI'] = parseFloat(String(adaptor['RSSI']).replace(/dBm$/, ''));
        }

        return unitInfo;
    }

    close(): void {
        this.agent.destroy();
    }

    private httpRequest(
        method: string,
        targetUrl: string,
        headers: Record<string, string>,
        body?: string,
    ): Promise<{ statusCode: number; body: Buffer }> {
        return new Promise((resolve, reject) => {
            const target = new URL(targetUrl);
            const bodyBuf = body !== undefined ? Buffer.from(body, 'utf-8') : undefined;

            const finalHeaders =
                bodyBuf !== undefined && !('Content-Length' in headers)
                    ? {...headers, 'Content-Length': String(bodyBuf.byteLength)}
                    : headers;

            const options: http.RequestOptions = {
                host: target.hostname,
                port: target.port || 80,
                method,
                path: target.pathname + target.search,
                headers: finalHeaders,
                agent: this.agent,
            };

            const req = http.request(options, (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c: Buffer) => chunks.push(c));
                res.on('end', () => resolve({statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks)}));
            });
            req.on('error', reject);
            if (bodyBuf !== undefined) {
                req.write(bodyBuf);
            }
            req.end();
        });
    }
}
