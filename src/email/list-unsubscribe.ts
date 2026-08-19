/**
 * En-têtes de désabonnement en un clic (RFC 2369 et RFC 8058).
 *
 * Le lien en pied de message reste l'obligation légale ; ces en-têtes s'y
 * ajoutent pour que le client mail affiche son propre bouton « Se désabonner »,
 * en haut du message, avant même qu'on ait lu quoi que ce soit. C'est aussi ce
 * que Gmail et Yahoo attendent d'un expéditeur en volume — pas encore notre cas,
 * mais un en-tête absent le jour où le volume arrive se paie en réputation
 * d'expédition, pas en avertissement.
 *
 * Les deux vont ensemble et ne se dissocient pas :
 *
 * - `List-Unsubscribe` seul ferait ouvrir l'URL au client mail, à sa façon ;
 * - `List-Unsubscribe-Post` promet qu'un `POST` sur cette URL suffit, sans page
 *   intermédiaire ni confirmation. L'API tient cette promesse : elle expose la
 *   même action en `POST`. L'annoncer sans la tenir donnerait un bouton
 *   « Se désabonner » qui échoue en silence — pire que pas de bouton du tout.
 *
 * Les chevrons sont exigés par la RFC, pas décoratifs : une URL nue est ignorée.
 */
export function listUnsubscribeHeaders(
  unsubscribeUrl: string,
): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
