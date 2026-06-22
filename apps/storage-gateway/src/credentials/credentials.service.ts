import { Injectable } from '@nestjs/common';
import * as CryptoJS from 'crypto-js';

@Injectable()
export class CredentialsService {
  private readonly key: string;

  constructor() {
    this.key = process.env.ENCRYPTION_KEY;
    if (!this.key || this.key.length < 32) {
      throw new Error('ENCRYPTION_KEY debe tener al menos 32 caracteres');
    }
  }

  encrypt(data: object): string {
    const json = JSON.stringify(data);
    return CryptoJS.AES.encrypt(json, this.key).toString();
  }

  decrypt<T = Record<string, string>>(ciphertext: string): T {
    const bytes = CryptoJS.AES.decrypt(ciphertext, this.key);
    const json = bytes.toString(CryptoJS.enc.Utf8);
    return JSON.parse(json) as T;
  }
}
