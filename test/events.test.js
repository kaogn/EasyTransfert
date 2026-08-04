import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createEventHub } from '../src/events.js';

/** Imite juste ce que le hub utilise d'une reponse Express. */
function fausseReponse() {
  const res = new EventEmitter();
  res.ecrit = [];
  res.entetes = null;
  res.writeHead = (code, entetes) => { res.entetes = entetes; return res; };
  res.write = (chunk) => { res.ecrit.push(chunk); return true; };
  res.flushHeaders = () => {};
  res.termine = false;
  // Node emet 'close' quand la reponse se termine : on reproduit ce couplage,
  // sinon le test ne prouverait pas que le hub oublie bien l'abonne.
  res.end = () => { res.termine = true; res.emit('close'); };
  return res;
}

test('subscribe ouvre un flux SSE et compte l abonne', () => {
  const hub = createEventHub();
  const res = fausseReponse();
  hub.subscribe(res);

  assert.equal(hub.count, 1);
  assert.equal(res.entetes['Content-Type'], 'text/event-stream');
});

test('broadcast envoie a tous les abonnes au format SSE', () => {
  const hub = createEventHub();
  const a = fausseReponse();
  const b = fausseReponse();
  hub.subscribe(a);
  hub.subscribe(b);

  hub.broadcast('files-changed');

  assert.equal(a.ecrit.at(-1), 'data: {"type":"files-changed"}\n\n');
  assert.equal(b.ecrit.at(-1), 'data: {"type":"files-changed"}\n\n');
});

test('un abonne deconnecte est oublie', () => {
  const hub = createEventHub();
  const res = fausseReponse();
  hub.subscribe(res);
  res.emit('close');

  assert.equal(hub.count, 0);
  hub.broadcast('files-changed'); // ne doit pas lever
});

test('disconnectAll ferme tous les flux et vide la liste des abonnes', () => {
  const hub = createEventHub();
  const a = fausseReponse();
  const b = fausseReponse();
  hub.subscribe(a);
  hub.subscribe(b);

  hub.disconnectAll();

  assert.equal(a.termine, true);
  assert.equal(b.termine, true);
  assert.equal(hub.count, 0);
  hub.broadcast('files-changed'); // ne doit pas lever ni ecrire
  assert.equal(a.ecrit.length, 0);
});
