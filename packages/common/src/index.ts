import encode from 'base32-encode';
import decode from 'base32-decode';
import * as nacl from 'tweetnacl';
import * as EthUtil from 'ethereumjs-util';

const ethjsUtil = require('ethjs-util');


/**
 * converts string to bytes
 * @param value string
 */
export function bytesFromString(value: string): Uint8Array {
  const u8a = new Uint8Array(value.length);

  for (let i = 0; i < value.length; i += 1) {
    u8a[i] = value.charCodeAt(i);
  }

  return u8a;
}

/**
 * Removes "0x" from a given `String` if it starts with "0x".
 * @param str hex string with 0x prefix
 */
export function removeHexPrefix(str: string): string {
  if (typeof str !== 'string') {
    return str;
  }
  return ethjsUtil.isHexPrefixed(str) ? str.substring(2) : str;
}

/**
 * converts a number to bytes
 * @param number integer
 */
export function bytesFromNumber(number : number | string): Uint8Array {
  let long = (typeof number === 'string') ? parseInt(number, 16) : number;
  const byteArray = [0, 0, 0, 0, 0, 0, 0, 0];

  for (let index = 0; index < byteArray.length; index += 1) {
    // eslint-disable-next-line no-bitwise
    const byte = long & 0xff;
    byteArray[index] = byte;
    long = (long - byte) / 256;
  }

  return new Uint8Array(byteArray);
}

/**
 * converts a bytes to a number
 * @param bytes uint8array to convert
 */
export function numberFromBytes(bytes: Uint8Array): number {
  const byteArray = [].slice.call(bytes);
  let value = 0;
  for (let i = byteArray.length - 1; i >= 0; i -= 1) {
    value = (value * 256) + byteArray[i];
  }
  return value;
}

/**
 * converts hex string to bytes
 * @param str hex string
 */
export function bytesFromHexString(str: string): Uint8Array {
  if (!str) {
    return new Uint8Array();
  }
  const value = removeHexPrefix(str);
  const a = [];
  for (let i = 0, len = value.length; i < len; i += 2) {
    a.push(parseInt(value.substr(i, 2), 16));
  }
  return new Uint8Array(a);
}

export function hexStringFromBytes(byteArray: Uint8Array) {
  // eslint-disable-next-line no-bitwise
  return Array.prototype.map.call(byteArray, (byte: any) => (`0${(byte & 0xFF).toString(16)}`).slice(-2)).join('');
}


/**
 * converts a base32 encoded string to bytes
 * @param str base32 string
 */
export function bytesFromBase32String(str: string) : Uint8Array {
  return new Uint8Array(decode(str, 'RFC4648'));
}

/**
 * coverts bytes to a base32 string
 * @param bytes Uint8Array to be encoded to base32
 */
export function base32StringFromBytes(bytes: Uint8Array) : string {
  return encode(bytes, 'RFC4648', { padding: false });
}

/**
 * returns the public key of a ed25519 private key
 * @param privateKey ed25519 private key
 */
export function getPublicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  const keypair = nacl.sign.keyPair.fromSecretKey(privateKey);
  return keypair.publicKey;
}

/**
 * returns the address of a public key
 * @param pubKey ed25519 public key
 */
export function addressFromPublicKey(pubKey: Uint8Array): Uint8Array {
  return new Uint8Array(EthUtil.keccak(Buffer.from(pubKey)).slice(-20));
}

/**
 * checks if valid ed25519 private key
 * @param privateKey ed25519 private key
 */
export function isValidPrivate(privateKey: Uint8Array): boolean {
  if (privateKey.length !== nacl.sign.secretKeyLength) {
    return false;
  }
  return true;
}

/**
 * checks if valid ed25519 public key
 * @param publicKey ed25519 public key
 */
export function isValidPublic(publicKey: Uint8Array): boolean {
  if (publicKey.length !== nacl.sign.publicKeyLength) {
    return false;
  }
  return true;
}

/**
 * checks an object against a schema
 * @param obj object with the properties to validate
 * @param schema
 */
export function validateProperties(obj: any, schema: object) {
  return Object
    .entries(schema)
    .map(([key, validate]) => [
      key,
      !validate.required || (key in obj),
      validate(obj[key]),
    ])
    .filter(([_, ...tests]) => !tests.every(Boolean))
    .map(([key, invalid]) => new Error(`${key} is ${invalid ? 'invalid' : 'required'}.`));
}
