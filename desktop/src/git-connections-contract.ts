/** Public, non-secret contract for the next connector milestone. No network or credential storage here. */
export type GitProvider = 'github' | 'gitlab';
export interface GitConnectionIdentity {
  id: string;
  provider: GitProvider;
  instanceUrl: string;
  accountId: string;
  label: string;
}
export interface GitSource {
  connectionId: string;
  kind: 'file' | 'issue' | 'pull-request' | 'merge-request';
  repositoryId: string;
  revision?: string;
  url: string;
  title: string;
  text: string;
}
/** Preserve a GitLab relative URL root, including self-hosted installations under /gitlab. */
export function gitInstance(value: string, provider: GitProvider): {instanceUrl:string;apiUrl:string} {
  const url = (() => {try {return new URL(value);} catch {throw new Error('Adresse d’instance invalide.');}})();
  if(url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw new Error('Utilisez une URL HTTPS sans identifiant, paramètres ni fragment.');
  const path=url.pathname.replace(/\/+$/,'');
  if(provider==='github' && path) throw new Error('Indiquez la racine du serveur GitHub, sans /api/v3.');
  if(/\/(?:api\/v4|api\/v3)$/i.test(path)) throw new Error('Indiquez l’URL de l’instance, sans le suffixe API.');
  const instanceUrl=`${url.origin}${path}`;
  if(provider==='gitlab') return {instanceUrl,apiUrl:`${instanceUrl}/api/v4`};
  return {instanceUrl,apiUrl:url.hostname==='github.com' ? 'https://api.github.com' : `${instanceUrl}/api/v3`};
}
/** Select explicitly; importing a page never grants the underlying connection to its readers. */
export function selectedGitSources(connectionId:string, accessible:readonly GitSource[], selectedUrls:readonly string[]):GitSource[] {
  const selected=new Set(selectedUrls);
  const sources=accessible.filter(source=>source.connectionId===connectionId && selected.has(source.url));
  if(new Set(sources.map(source=>source.url)).size!==selected.size) throw new Error('Une source sélectionnée n’est plus accessible dans cette connexion.');
  return sources.map(source=>({...source}));
}
