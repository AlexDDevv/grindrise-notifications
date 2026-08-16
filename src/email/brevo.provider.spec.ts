import { PermanentEmailError, TransientEmailError, type EmailMessage } from './email-provider';
import { BrevoEmailProvider } from './brevo.provider';

const message: EmailMessage = {
  to: { email: 'joueur@exemple.fr', name: 'Ferrum' },
  subject: 'Niveau 5 atteint',
  html: '<p>Bravo</p>',
  text: 'Bravo',
};

function respondWith(status: number, body = '{}'): jest.SpyInstance {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body, { status }));
}

describe('BrevoEmailProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it("appelle l'API transactionnelle avec la clé en en-tête", async () => {
    const fetchSpy = respondWith(201, '{"messageId":"<abc@brevo>"}');
    const provider = new BrevoEmailProvider('xkeysib-test', {
      email: 'expediteur@exemple.fr',
      name: 'Grindrise',
    });

    await provider.send(message);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');
  });

  it('envoie un corps conforme au format Brevo', async () => {
    const fetchSpy = respondWith(201);
    const provider = new BrevoEmailProvider('xkeysib-test', {
      email: 'expediteur@exemple.fr',
      name: 'Grindrise',
    });

    await provider.send(message);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { email: 'expediteur@exemple.fr', name: 'Grindrise' },
      to: [{ email: 'joueur@exemple.fr', name: 'Ferrum' }],
      subject: 'Niveau 5 atteint',
      htmlContent: '<p>Bravo</p>',
      textContent: 'Bravo',
    });
  });

  it("n'ajoute replyTo que s'il est configuré", async () => {
    const fetchSpy = respondWith(201);
    const provider = new BrevoEmailProvider('xkeysib-test', {
      email: 'expediteur@exemple.fr',
      name: 'Grindrise',
      replyTo: 'contact@exemple.fr',
    });

    await provider.send(message);

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).replyTo).toEqual({ email: 'contact@exemple.fr' });
  });

  it.each([400, 401, 403])('traite %i comme un échec définitif', async (status) => {
    // Une clé invalide ou un expéditeur non validé ne guérira pas en cinq
    // tentatives : il faut que ça remonte tout de suite.
    respondWith(status, '{"message":"Key not found"}');
    const provider = new BrevoEmailProvider('mauvaise-cle', {
      email: 'expediteur@exemple.fr',
      name: 'Grindrise',
    });

    await expect(provider.send(message)).rejects.toBeInstanceOf(PermanentEmailError);
  });

  it.each([429, 500, 503])('traite %i comme un échec passager', async (status) => {
    // 429 est le quota de 300/jour du plan gratuit : l'email se rattrape au
    // lendemain plutôt que de se perdre.
    respondWith(status, '{"message":"Too many requests"}');
    const provider = new BrevoEmailProvider('xkeysib-test', {
      email: 'expediteur@exemple.fr',
      name: 'Grindrise',
    });

    await expect(provider.send(message)).rejects.toBeInstanceOf(TransientEmailError);
  });

  it('traite une panne réseau comme un échec passager', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    const provider = new BrevoEmailProvider('xkeysib-test', {
      email: 'expediteur@exemple.fr',
      name: 'Grindrise',
    });

    await expect(provider.send(message)).rejects.toBeInstanceOf(TransientEmailError);
  });

  it("reporte le corps de la réponse dans le message d'erreur", async () => {
    respondWith(400, '{"message":"Sender not valid"}');
    const provider = new BrevoEmailProvider('xkeysib-test', {
      email: 'inconnu@exemple.fr',
      name: 'Grindrise',
    });

    await expect(provider.send(message)).rejects.toThrow(/Sender not valid/);
  });
});
