// Creates the Android signing key used by the GitHub build:
//   node scripts/make-signing-key.js <output-folder>
// Keep that folder private and backed up. Every update must be signed with the same key,
// otherwise phones refuse to install it over the existing app (and its data).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const forge = require('node-forge');

const out = process.argv[2];
if (!out) {
  console.error('Usage: node scripts/make-signing-key.js <output-folder>');
  process.exit(1);
}

const password = crypto.randomBytes(18).toString('base64url');
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const key = forge.pki.privateKeyFromPem(privateKey);

const cert = forge.pki.createCertificate();
cert.publicKey = forge.pki.setRsaPublicKey(key.n, key.e);
cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 30);
const name = [{ name: 'commonName', value: 'Gym Tracker' }];
cert.setSubject(name);
cert.setIssuer(name);
cert.sign(key, forge.md.sha256.create());

// PKCS#12 with the alias Gradle expects ("gymtracker").
const p12 = forge.pkcs12.toPkcs12Asn1(key, [cert], password, { algorithm: '3des', friendlyName: 'gymtracker', generateLocalKeyId: true });
const der = Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'release.p12'), der);
fs.writeFileSync(path.join(out, 'ANDROID_KEYSTORE_BASE64.txt'), der.toString('base64'));
fs.writeFileSync(path.join(out, 'ANDROID_KEYSTORE_PASSWORD.txt'), password);
console.log(`Signing key written to ${path.resolve(out)}`);
