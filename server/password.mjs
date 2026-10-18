import {passwordHash} from '../src/core.mjs';
// Password via stdin only. Output is a salted hash, never the plaintext password.
let password='';for await(const chunk of process.stdin){password+=chunk;if(password.length>1024)throw new Error('Password too long')}
password=password.replace(/\r?\n$/,'');if(password.length<8)throw new Error('Use at least 8 characters');console.log('APP_PASSWORD_HASH='+await passwordHash(password));
