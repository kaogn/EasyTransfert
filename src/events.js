/**
 * Diffuse les changements du dossier partage vers tous les navigateurs connectes,
 * pour que le PC et le telephone affichent la meme liste sans rechargement.
 */
export function createEventHub() {
  const abonnes = new Set();

  function subscribe(res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Neutralise la mise en tampon d'un eventuel proxy.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    abonnes.add(res);
    res.on('close', () => abonnes.delete(res));
  }

  function broadcast(type) {
    const message = `data: ${JSON.stringify({ type })}\n\n`;
    for (const res of abonnes) res.write(message);
  }

  return {
    subscribe,
    broadcast,
    get count() {
      return abonnes.size;
    },
  };
}
