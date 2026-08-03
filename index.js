const crypto = require('crypto');

class Zetoken {
    resolveKeys(keyId, secretKey) {
        const finalKeyId = keyId || process.env.ZETOKEN_ACCESS_KEY_ID || null;
        const finalSecret = secretKey || process.env.ZETOKEN_SECRET_KEY || null;

        let finalIterations = parseInt(process.env.ZETOKEN_ITERATIONS || '1000', 10);
        if (isNaN(finalIterations) || finalIterations < 1) {
            finalIterations = 1000;
        }

        return [finalKeyId, finalSecret, finalIterations];
    }

    deriveCryptographicKey(startPoint, seed, iterations) {
        return crypto.pbkdf2Sync(seed, startPoint, iterations, 16, 'sha512');
    }

    encode(text, keyId = null, secretKey = null, ttl = null) {
        const [kid, sec, iterations] = this.resolveKeys(keyId, secretKey);

        if (!kid || !sec) {
            return false;
        }

        if (ttl !== null && typeof ttl === 'number' && ttl > 0) {
            const expTime = Math.floor(Date.now() / 1000) + ttl;
            text = `${text}__ZTX__${expTime}`;
        }

        const aesKey = this.deriveCryptographicKey(kid, sec, iterations);

        const iv = crypto.randomBytes(12);

        const cipher = crypto.createCipheriv('aes-128-gcm', aesKey, iv);
        
        let cipherText = cipher.update(text, 'utf8');
        cipherText = Buffer.concat([cipherText, cipher.final()]);
        
        const tag = cipher.getAuthTag();

        const payload = Buffer.concat([iv, tag, cipherText]);

        let numericResult = "";
        for (let i = 0; i < payload.length; i++) {
            numericResult += payload[i].toString().padStart(3, '0');
        }

        return numericResult;
    }

    decode(cipherText, keyId = null, secretKey = null, leeway = 60) {
        const [kid, sec, iterations] = this.resolveKeys(keyId, secretKey);

        if (!kid || !sec) {
            return false;
        }

        if (cipherText.length % 3 !== 0 || !/^\d+$/.test(cipherText)) {
            return false;
        }

        const decodedBytes = Buffer.alloc(cipherText.length / 3);
        for (let i = 0; i < cipherText.length; i += 3) {
            decodedBytes[i / 3] = parseInt(cipherText.substring(i, i + 3), 10);
        }

        if (decodedBytes.length < 28) {
            return false;
        }

        const iv = decodedBytes.subarray(0, 12);
        const tag = decodedBytes.subarray(12, 28);
        const actualCipherText = decodedBytes.subarray(28);

        const aesKey = this.deriveCryptographicKey(kid, sec, iterations);

        const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv);
        decipher.setAuthTag(tag);

        try {
            let decrypted = decipher.update(actualCipherText);
            decrypted = Buffer.concat([decrypted, decipher.final()]);
            const decryptedText = decrypted.toString('utf8');

            const pos = decryptedText.lastIndexOf('__ZTX__');
            if (pos !== -1) {
                const expString = decryptedText.substring(pos + 7); 
                
                if (/^\d+$/.test(expString)) {
                    const expTime = parseInt(expString, 10);
                    const currentTime = Math.floor(Date.now() / 1000);
                    
                    if ((currentTime - leeway) > expTime) {
                        return false;
                    }

                    return decryptedText.substring(0, pos);
                }
            }

            return decryptedText;
        } catch (error) {
            return false;
        }
    }

    sign(text, keyId, secretKey = null, ttl = null) {
        const [masterAccessKey, masterSecretKey] = this.resolveKeys(null, secretKey);

        if (!masterAccessKey || !masterSecretKey || !keyId) {
            return false;
        }

        const layeredKeyId = `${masterAccessKey}::${keyId}`;

        return this.encode(text, layeredKeyId, masterSecretKey, ttl);
    }

    verifySign(token, keyId, secretKey = null, leeway = 60) {
        const [masterAccessKey, masterSecretKey] = this.resolveKeys(null, secretKey);

        if (!masterAccessKey || !masterSecretKey || !keyId) {
            return false;
        }

        const layeredKeyId = `${masterAccessKey}::${keyId}`;

        return this.decode(token, layeredKeyId, masterSecretKey, leeway);
    }
}

module.exports = Zetoken;