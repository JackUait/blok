import {describe,expect,it} from 'vitest';
import {gitInstance,selectedGitSources,type GitSource} from './git-connections-contract';
describe('future Git connector public contract',()=>{
 it.each([
  ['github','https://github.com/','https://github.com','https://api.github.com'],
  ['github','https://git.example.org:8443','https://git.example.org:8443','https://git.example.org:8443/api/v3'],
  ['gitlab','https://gitlab.com','https://gitlab.com','https://gitlab.com/api/v4'],
  ['gitlab','https://code.example.org/gitlab/','https://code.example.org/gitlab','https://code.example.org/gitlab/api/v4'],
 ] as const)('routes %s at %s with its explicit instance', (provider,input,instanceUrl,apiUrl)=>{expect(gitInstance(input,provider)).toEqual({instanceUrl,apiUrl});});
 it.each(['http://gitlab.example.org','https://token@gitlab.com','https://gitlab.com?token=secret','https://gitlab.com/#fragment','https://gitlab.com/api/v4','nonsense'])('rejects unsafe or ambiguous instance input %s',url=>{expect(()=>gitInstance(url,'gitlab')).toThrow();});
 it('keeps accounts on the same self-hosted origin separate and rejects missing sources',()=>{
  const a:GitSource={connectionId:'account-a',kind:'file',repositoryId:'12',url:'https://gitlab.example.org/group/repo/-/blob/main/README.md',title:'README',text:'Source'};
  const b={...a,connectionId:'account-b',text:'Private other account'};
  expect(selectedGitSources('account-a',[a,b],[a.url])).toEqual([a]);
  expect(()=>selectedGitSources('account-c',[a,b],[a.url])).toThrow('plus accessible');
  expect(()=>selectedGitSources('account-a',[a],['https://other.example.org/private'])).toThrow();
 });
});
