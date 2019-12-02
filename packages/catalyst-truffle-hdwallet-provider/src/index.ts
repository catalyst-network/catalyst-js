import * as bip39 from "bip39";
import * as EthUtil from "ethereumjs-util";
import ethJSWallet from "ethereumjs-wallet";
import EthereumHDKey from "ethereumjs-wallet/hdkey";
import Transaction from "ethereumjs-tx";
import ProviderEngine from "web3-provider-engine";
import FiltersSubprovider from "web3-provider-engine/subproviders/filters";
import NonceSubProvider from "web3-provider-engine/subproviders/nonce-tracker";
import HookedSubprovider from "web3-provider-engine/subproviders/hooked-wallet";
import ProviderSubprovider from "web3-provider-engine/subproviders/provider";
import Url from "url";
import Web3 from "web3";
import { JSONRPCRequestPayload, JSONRPCErrorCallback } from "ethereum-protocol";
import { Callback, JsonRpcResponse } from "@truffle/provider";
import {derivePath } from 'ed25519-hd-key';
import nacl, { SignKeyPair } from 'tweetnacl'
import { toHex } from "web3-utils";


// Important: do not use debug module. Reason: https://github.com/trufflesuite/truffle/issues/2374#issuecomment-536109086

// This line shares nonce state across multiple provider instances. Necessary
// because within truffle the wallet is repeatedly newed if it's declared in the config within a
// function, resetting nonce from tx to tx. An instance can opt out
// of this behavior by passing `shareNonce=false` to the constructor.
// See issue #65 for more
const singletonNonceSubProvider = new NonceSubProvider();

class HDWalletProvider {
  private walletHdpath: string;
  private wallets: { [address: string]: any };
  private addresses: string[];

  public engine: ProviderEngine;

  constructor(
    mnemonic: string | string[],
    provider: string | any,
    addressIndex: number = 0,
    numAddresses: number = 10,
    shareNonce: boolean = true,
    walletHdpath: string = `m/44'/42069'/`
  ) {
    this.walletHdpath = walletHdpath;
    this.wallets = {};
    this.addresses = [];
    this.engine = new ProviderEngine();

    if (!HDWalletProvider.isValidProvider(provider)) {
      throw new Error(
        [
          `Malformed provider URL: '${provider}'`,
          "Please specify a correct URL, using the http, https, ws, or wss protocol.",
          ""
        ].join("\n")
      );
    }

    function generateKeyFromSeed(seed: Uint8Array): SignKeyPair {
      return nacl.sign.keyPair.fromSeed(seed)
    };

    function generateKeyFromPrivateKey(key: Uint8Array): SignKeyPair {
      return nacl.sign.keyPair.fromSecretKey(key)
    };

    function toHexString(byteArray: Uint8Array) {
      return Array.prototype.map.call(byteArray, function(byte) {
        return ('0' + (byte & 0xFF).toString(16)).slice(-2);
      }).join('');
    }

    function fromHexString(hexString: any): Uint8Array {
      return new Uint8Array(hexString.match(/.{1,2}/g).map((byte: any) => parseInt(byte, 16)));
    }

    // private helper to normalize given mnemonic
    const normalizePrivateKeys = (
      mnemonic: string | string[]
    ): string[] | false => {
      if (Array.isArray(mnemonic)) return mnemonic;
      else if (mnemonic && !mnemonic.includes(" ")) return [mnemonic];
      // if truthy, but no spaces in mnemonic
      else return false; // neither an array nor valid value passed;
    };

    // private helper to check if given mnemonic uses BIP39 passphrase protection
    const checkBIP39Mnemonic = (mnemonic: string) => {
      if (!bip39.validateMnemonic(mnemonic)) {
        throw new Error("Mnemonic invalid or undefined");
      }

      const seed = bip39.mnemonicToSeedHex(mnemonic);

      // crank the addresses out
      for (let i = addressIndex; i < addressIndex + numAddresses; i++) {
        const data = derivePath(`${this.walletHdpath + i}\'`, seed)
        const keypair = generateKeyFromSeed(data.key);
            
        const wallet = {
          privateKey: keypair.secretKey,
          privateKeyHex: toHexString(keypair.secretKey),
        };
      
        const address = EthUtil.keccak(Buffer.from(keypair.publicKey)).slice(-20);
        const addr = EthUtil.bufferToHex(address);
        this.addresses.push(addr);
        this.wallets[addr] = wallet;
      }
    };

    // private helper leveraging ethUtils to populate wallets/addresses
    const ethUtilValidation = (privateKeys: string[]) => {
      // crank the addresses out
      for (let i = addressIndex; i < privateKeys.length; i++) {
          const key = fromHexString(privateKeys[i]);
          const keypair = generateKeyFromPrivateKey(key);
          
          const wallet = {
            privateKey: keypair.secretKey,
            privateKeyHex: privateKeys[i]
          }

          const address = EthUtil.keccak(Buffer.from(keypair.publicKey)).slice(-20);
          const addr = EthUtil.bufferToHex(address);
          this.addresses.push(addr);
          this.wallets[addr] = wallet;
      }
    };

    const privateKeys = normalizePrivateKeys(mnemonic);

    if (!privateKeys) checkBIP39Mnemonic(mnemonic as string);
    else ethUtilValidation(privateKeys);

    const tmp_accounts = this.addresses;
    const tmp_wallets = this.wallets;

    this.engine.addProvider(
      new HookedSubprovider({
        getAccounts(cb: any) {
          cb(null, tmp_accounts);
        },
        getPrivateKey(address: string, cb: any) {
          if (!tmp_wallets[address]) {
            return cb("Account not found");
          } else {
            cb(null, tmp_wallets[address].privateKeyHex);
          }
        },
        signTransaction(txParams: any, cb: any) {
          let pkey;
          const from = txParams.from.toLowerCase();
          if (tmp_wallets[from]) {
            pkey = tmp_wallets[from].privateKey;
          } else {
            cb("Account not found");
          }
          const tx = new Transaction(txParams);
          tx.sign(pkey as Buffer);
          const rawTx = `0x${tx.serialize().toString("hex")}`;
          cb(null, rawTx);
        },
        signMessage({ data, from }: any, cb: any) {
          const dataIfExists = data;
          if (!dataIfExists) {
            cb("No data to sign");
          }
          if (!tmp_wallets[from]) {
            cb("Account not found");
          }
          let pkey = tmp_wallets[from].privateKey;
          const dataBuff = EthUtil.toBuffer(dataIfExists);
          const msgHashBuff = EthUtil.hashPersonalMessage(dataBuff);
          const sig = EthUtil.ecsign(msgHashBuff, pkey);
          const rpcSig = EthUtil.toRpcSig(sig.v, sig.r, sig.s);
          cb(null, rpcSig);
        },
        signPersonalMessage(...args: any[]) {
          this.signMessage(...args);
        }
      })
    );

    !shareNonce
      ? this.engine.addProvider(new NonceSubProvider())
      : this.engine.addProvider(singletonNonceSubProvider);

    this.engine.addProvider(new FiltersSubprovider());
    if (typeof provider === "string") {
      // shim Web3 to give it expected sendAsync method. Needed if web3-engine-provider upgraded!
      // Web3.providers.HttpProvider.prototype.sendAsync =
      // Web3.providers.HttpProvider.prototype.send;
      this.engine.addProvider(
        new ProviderSubprovider(
          // @ts-ignore
          new Web3.providers.HttpProvider(provider, { keepAlive: false })
        )
      );
    } else {
      this.engine.addProvider(new ProviderSubprovider(provider));
    }
    this.engine.start(); // Required by the provider engine.
  }

  public send(
    payload: JSONRPCRequestPayload,
    callback: JSONRPCErrorCallback | Callback<JsonRpcResponse>
  ): void {
    return this.engine.send.call(this.engine, payload, callback);
  }

  public sendAsync(
    payload: JSONRPCRequestPayload,
    callback: JSONRPCErrorCallback | Callback<JsonRpcResponse>
  ): void {
    this.engine.sendAsync.call(this.engine, payload, callback);
  }

  public getAddress(idx?: number): string {
    if (!idx) {
      return this.addresses[0];
    } else {
      return this.addresses[idx];
    }
  }

  public getAddresses(): string[] {
    return this.addresses;
  }

  public static isValidProvider(provider: string | any): boolean {
    const validProtocols = ["http:", "https:", "ws:", "wss:"];

    if (typeof provider === "string") {
      const url = Url.parse(provider.toLowerCase());
      return !!(validProtocols.includes(url.protocol || "") && url.slashes);
    }

    return true;
  }
}

export = HDWalletProvider;