import { listUnsubscribeHeaders } from './list-unsubscribe';

const URL = 'https://api.exemple.test/notifications/unsubscribe?token=abc.def';

describe('listUnsubscribeHeaders', () => {
  it('encadre l’URL de chevrons, comme l’exige la RFC 2369', () => {
    // Une URL nue est ignorée par les clients mail : le bouton n'apparaît pas,
    // et rien ne le signale.
    expect(listUnsubscribeHeaders(URL)['List-Unsubscribe']).toBe(`<${URL}>`);
  });

  it('annonce le désabonnement en un clic', () => {
    // La valeur est figée par la RFC 8058, au caractère près.
    expect(listUnsubscribeHeaders(URL)['List-Unsubscribe-Post']).toBe(
      'List-Unsubscribe=One-Click',
    );
  });

  it('ne produit que ces deux en-têtes', () => {
    expect(Object.keys(listUnsubscribeHeaders(URL)).sort()).toEqual([
      'List-Unsubscribe',
      'List-Unsubscribe-Post',
    ]);
  });
});
