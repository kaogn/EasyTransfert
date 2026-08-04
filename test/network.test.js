import test from 'node:test';
import assert from 'node:assert/strict';

import { listCandidateAddresses } from '../src/network.js';

const interfacesFictives = {
  'Loopback Pseudo-Interface 1': [
    { address: '127.0.0.1', family: 'IPv4', internal: true },
  ],
  'vEthernet (WSL)': [
    { address: '172.28.80.1', family: 'IPv4', internal: false },
  ],
  'VirtualBox Host-Only Network': [
    { address: '192.168.56.1', family: 'IPv4', internal: false },
  ],
  Ethernet: [
    { address: '192.168.1.42', family: 'IPv4', internal: false },
  ],
  'Wi-Fi': [
    { address: '192.168.1.20', family: 'IPv4', internal: false },
    { address: 'fe80::1', family: 'IPv6', internal: false },
  ],
};

test('ecarte le loopback, les interfaces virtuelles et l IPv6', () => {
  const adresses = listCandidateAddresses(interfacesFictives).map((c) => c.address);
  assert.deepEqual([...adresses].sort(), ['192.168.1.20', '192.168.1.42']);
});

test('place le Wi-Fi avant l Ethernet', () => {
  const candidats = listCandidateAddresses(interfacesFictives);
  assert.equal(candidats[0].address, '192.168.1.20');
  assert.equal(candidats[0].name, 'Wi-Fi');
});

test('retourne une liste vide sans lever quand rien ne convient', () => {
  const seulementLoopback = {
    'Loopback Pseudo-Interface 1': [
      { address: '127.0.0.1', family: 'IPv4', internal: true },
    ],
  };
  assert.deepEqual(listCandidateAddresses(seulementLoopback), []);
});

test('conserve une interface au nom inconnu plutot que de la jeter', () => {
  const inconnue = {
    'Carte reseau 3': [{ address: '10.0.0.5', family: 'IPv4', internal: false }],
  };
  assert.deepEqual(listCandidateAddresses(inconnue), [
    { name: 'Carte reseau 3', address: '10.0.0.5' },
  ]);
});

test('ecarte les adresses link-local APIPA', () => {
  const avecAPIPA = {
    'Ethernet 2': [{ address: '169.254.123.224', family: 'IPv4', internal: false }],
    'Wi-Fi': [{ address: '192.168.1.20', family: 'IPv4', internal: false }],
  };
  const candidats = listCandidateAddresses(avecAPIPA);
  assert.equal(candidats.length, 1);
  assert.equal(candidats[0].address, '192.168.1.20');
});
