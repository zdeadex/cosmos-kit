import { Algo } from '@cosmjs/amino';
import {
  AddRaw,
  AuthRange,
  Block,
  getStringFromUint8Array,
  isMessageDoc,
  Namespace,
  Signature,
  WalletAccount,
  WalletClient,
} from '@cosmos-kit/core';
import { CosmosWalletAccount } from '@cosmos-kit/cosmos';
import {
  AddChainParams,
  AptosPendingTransaction,
  AptosSignMessageResponse,
  SendTransactionMode,
  SendTransactionResponse,
  SignAminoResponse,
  SignDirectResponse,
  SignMessageResponse,
  SignOptions,
  VerifyMessageResponse,
} from '@cosmostation/extension-client/types/message';
import {
  isAptosMessageSignDoc,
  isAptosTransactionSignDoc,
  isCosmosAminoSignDoc,
  isCosmosDirectSignDoc,
  isCosmosMessageSignDoc,
  isCosmosTransactionBroadcastDoc,
  isEthMessageSignDoc,
  isEthTransactionSignDoc,
  isEthTypedDataSignDoc,
  isSuiTransactionSignDoc,
} from './type-guards';

import {
  CosmosBroadcastDoc,
  Cosmostation,
  SignDoc,
  WalletAddEthereumChainParam,
} from './types';

export class CosmostationClient implements WalletClient {
  readonly client: Cosmostation;
  private eventMap: Map<
    string,
    Map<EventListenerOrEventListenerObject, Event>
  > = new Map();

  constructor(client: Cosmostation) {
    this.client = client;
  }

  get cosmos() {
    return this.client.cosmos;
  }

  get ikeplr() {
    return this.client.providers.keplr;
  }

  async connect(authRange: AuthRange): Promise<void> {
    await Promise.all(
      Object.entries(authRange).map(async ([namespace, { chainIds }]) => {
        switch (namespace) {
          case 'aptos':
            await this.client.aptos.request({ method: 'aptos_connect' });
            return;
          case 'sui':
            await this.client.sui.request({ method: 'sui_connect' });
            return;
          default:
            return Promise.reject('Unmatched namespace.');
        }
      })
    );
  }

  async addChain(namespace: Namespace, chainInfo: unknown): Promise<void> {
    switch (namespace) {
      case 'cosmos':
        this.client.cosmos.request({
          method: 'cos_addChain',
          params: chainInfo as AddChainParams,
        });
        return;
      case 'ethereum':
        this.client.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: chainInfo as WalletAddEthereumChainParam,
        });
        return;
      default:
        return Promise.reject('Unmatched namespace.');
    }
  }

  switchChain(namespace: Namespace, chainId: string): Promise<void> {
    switch (namespace) {
      case 'ethereum':
        this.client.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId }],
        });
        return;
      default:
        return Promise.reject('Unmatched namespace.');
    }
  }

  async getAccounts(authRange: AuthRange): Promise<AddRaw<WalletAccount>[]> {
    const accountsList = await Promise.all(
      Object.entries(authRange).map(async ([namespace, { chainIds }]) => {
        switch (namespace) {
          case 'cosmos':
            if (!chainIds) {
              return Promise.reject('No chainIds provided.');
            }
            return Promise.all(
              chainIds.map(async (chainId) => {
                const key = (await this.cosmos.request({
                  method: 'cos_requestAccount',
                  params: { chainName: chainId },
                })) as {
                  name: string;
                  address: string;
                  publicKey: Uint8Array;
                  isLedger: boolean;
                  algo: Algo;
                };
                return {
                  chainId,
                  namespace,
                  username: key.name,
                  address: {
                    value: key.address,
                    encoding: 'bech32',
                  },
                  publicKey: {
                    value: getStringFromUint8Array(key.publicKey, 'hex'),
                    encoding: 'hex',
                    algo: key.algo,
                  },
                } as CosmosWalletAccount;
              })
            );
          case 'ethereum':
            const ethAddrs = (await this.client.ethereum.request({
              method: 'eth_requestAccounts',
            })) as string[];
            return ethAddrs.map((address) => {
              return {
                namespace,
                address: {
                  value: address,
                  encoding: 'hex',
                },
              } as WalletAccount;
            });
          case 'aptos':
            const { address, publicKey } = (await this.client.aptos.request({
              method: 'aptos_account',
            })) as {
              address: string;
              publicKey: string;
            };
            return [
              {
                namespace,
                address: {
                  value: address,
                  encoding: 'hex',
                },
                publicKey: {
                  value: publicKey,
                  encoding: 'hex',
                },
              } as WalletAccount,
            ];
          case 'sui':
            const suiAddrs = (await this.client.sui.request({
              method: 'sui_getAccounts',
            })) as string[];
            const suiPublicKey = (await this.client.sui.request({
              method: 'sui_getPublicKey',
            })) as string;
            return suiAddrs.map((address) => {
              return {
                namespace,
                address: {
                  value: address,
                  encoding: 'hex',
                },
                publicKey: {
                  value: suiPublicKey,
                  encoding: 'hex',
                },
              } as WalletAccount;
            });
          default:
            return Promise.reject('Unmatched namespace.');
        }
      })
    );
    return accountsList.flat();
  }

  async sign(
    namespace: Namespace,
    doc: SignDoc,
    signerAddress?: string,
    chainId?: string,
    options?: SignOptions
  ): Promise<AddRaw<Signature>> {
    switch (namespace) {
      case 'cosmos':
        if (!chainId) {
          return Promise.reject('ChainId not provided.');
        }
        if (isMessageDoc(doc)) {
          const { pub_key, signature } = (await this.client.cosmos.request({
            method: 'cos_signMessage',
            params: {
              chainName: chainId,
              signer: signerAddress,
              message: doc,
            },
          })) as SignMessageResponse;
          return {
            publicKey: pub_key,
            signature: {
              value: signature,
            },
          };
        } else {
          let method: string;
          if (isCosmosDirectSignDoc(doc)) {
            method = 'cos_signDirect';
          } else if (isCosmosAminoSignDoc(doc)) {
            method = 'cos_signAmino';
          } else {
            return Promise.reject('Unmatched doc type.');
          }
          const {
            pub_key,
            signature,
            signed_doc,
          } = (await this.client.cosmos.request({
            method,
            params: {
              chainName: chainId,
              doc: doc,
              isEditMemo: !!(options === null || options === void 0
                ? void 0
                : options.memo),
              isEditFee: !!(options === null || options === void 0
                ? void 0
                : options.fee),
              gasRate:
                options === null || options === void 0
                  ? void 0
                  : options.gasRate,
            },
          })) as SignDirectResponse | SignAminoResponse;
          return {
            publicKey: pub_key,
            signature: {
              value: signature,
            },
            signedDoc: signed_doc,
          };
        }
      case 'ethereum':
        if (isEthMessageSignDoc(doc)) {
          const { result } = (await this.client.ethereum.request({
            method: 'eth_sign',
            params: [signerAddress, doc],
          })) as { result: string };
          return {
            signature: {
              value: result,
            },
          };
        } else if (isEthTransactionSignDoc(doc)) {
          const { result } = (await this.client.ethereum.request({
            method: 'eth_signTransaction',
            params: [doc],
          })) as { result: string };
          return {
            signature: {
              value: result,
            },
          };
        } else if (isEthTypedDataSignDoc(doc)) {
          const { result } = (await this.client.ethereum.request({
            method: 'eth_signTypedData_v4',
            params: [signerAddress, JSON.stringify(doc)],
          })) as { result: string };
          return {
            signature: {
              value: result,
            },
          };
        } else {
          return Promise.reject('Unmatched doc type.');
        }
      case 'aptos':
        if (isAptosMessageSignDoc(doc)) {
          const resp = (await this.client.aptos.request({
            method: 'aptos_signMessage',
            params: [doc],
          })) as AptosSignMessageResponse;
          return {
            signature: {
              value: resp.signature,
            },
            raw: resp,
          };
        } else if (isAptosTransactionSignDoc(doc)) {
          const signature = (await this.client.aptos.request({
            method: 'aptos_signTransaction',
            params: [doc],
          })) as string;
          return {
            signature: {
              value: signature,
            },
          };
        } else {
          return Promise.reject('Unmatched doc type.');
        }
      default:
        return Promise.reject('Unmatched namespace.');
    }
  }

  async verify(
    namespace: Namespace,
    signedDoc: unknown,
    signature: Signature,
    signerAddress?: string,
    chainId?: string
  ): Promise<boolean> {
    switch (namespace) {
      case 'cosmos':
        if (!chainId) {
          return Promise.reject('ChainId not provided.');
        }
        if (isCosmosMessageSignDoc(signedDoc)) {
          const result = (await this.client.cosmos.request({
            method: 'cos_verifyMessage',
            params: {
              chainName: chainId,
              signer: signerAddress,
              message: signedDoc,
              publicKey: signature.publicKey.value,
              signature: signature.signature.value,
            },
          })) as VerifyMessageResponse;
          return result;
        } else {
          return Promise.reject('Only support message string verification.');
        }
      default:
        return Promise.reject('Unmatched namespace.');
    }
  }

  async broadcast(
    namespace: Namespace,
    signedDoc: CosmosBroadcastDoc.Transaction,
    signerAddress?: string,
    chainId?: string,
    options?: {
      mode: SendTransactionMode;
    }
  ): Promise<AddRaw<Block>> {
    switch (namespace) {
      case 'cosmos':
        if (typeof options.mode === 'undefined') {
          return Promise.reject('Please provide broadcast mode.');
        }
        if (isCosmosTransactionBroadcastDoc(signedDoc)) {
          const response = (await this.client.cosmos.request({
            method: 'cos_sendTransaction',
            params: {
              chainName: chainId,
              txBytes: signedDoc,
              mode: options.mode,
            },
          })) as SendTransactionResponse;
          const { txhash, height, timestamp } = response.tx_response;
          return {
            hash: {
              value: txhash,
            },
            height: height as string,
            timestamp: timestamp as string,
            raw: response,
          };
        } else {
          return Promise.reject('Unmatched doc type.');
        }
      default:
        return Promise.reject('Unmatched namespace.');
    }
  }

  async signAndBroadcast(
    namespace: Namespace,
    doc: unknown,
    signerAddress?: string,
    chainId?: string,
    options?: unknown
  ): Promise<AddRaw<Block>> {
    switch (namespace) {
      case 'sui':
        if (isSuiTransactionSignDoc(doc)) {
          const suiResp = await this.client.sui.request({
            method: 'sui_signAndExecuteTransaction',
            params: doc,
          });
          return {
            hash: {
              value: suiResp['effects']['transactionDigest'],
            },
            raw: suiResp,
          };
        } else {
          return Promise.reject('Unmatched doc type.');
        }
      case 'aptos':
        if (isAptosTransactionSignDoc(doc)) {
          const aptosResp = (await this.client.aptos.request({
            method: 'aptos_signAndSubmitTransaction',
            params: [doc],
          })) as AptosPendingTransaction;
          return {
            hash: {
              value: aptosResp.hash,
            },
            height: aptosResp.sequence_number,
            raw: aptosResp,
          };
        } else {
          return Promise.reject('Unmatched doc type.');
        }
      default:
        return Promise.reject('Unmatched namespace.');
    }
  }

  async disconnect(authRange: AuthRange) {
    await Promise.all(
      Object.entries(authRange).map(async ([namespace, { chainIds }]) => {
        switch (namespace) {
          case 'cosmos':
            await this.client.cosmos.request({
              method: 'cos_disconnect',
            });
            return;
          default:
            return Promise.reject('Unmatched namespace.');
        }
      })
    );
  }

  // on(type: string, listener: EventListenerOrEventListenerObject): void {
  //   const event = this.cosmos.on(type, listener);
  //   const typeEventMap: Map<EventListenerOrEventListenerObject, Event> =
  //     this.eventMap.get(type) || new Map();
  //   typeEventMap.set(listener, event);
  //   this.eventMap.set(type, typeEventMap);
  // }

  // off(type: string, listener: EventListenerOrEventListenerObject): void {
  //   const event = this.eventMap.get(type)?.get(listener);
  //   if (event) {
  //     this.cosmos.off(event);
  //   }
  // }
}
