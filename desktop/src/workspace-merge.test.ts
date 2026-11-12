import { describe, expect, it } from 'vitest';
import { mergeWorkspaceIndex } from './workspace-merge';
import type { DesktopPage, WorkspaceIndex } from './storage';
const page = (id: string, values: Partial<DesktopPage> = {}): DesktopPage => ({id,title:id,parentId:null,...values});
const index = (...pages: DesktopPage[]): WorkspaceIndex => ({pages,trash:[],activeId:pages[0]?.id ?? ''});
describe('concurrent workspace metadata',()=>{
  it('keeps independently created pages from both writers',()=>{
    const merged=mergeWorkspaceIndex(index(page('a')),index(page('a'),page('mine')),index(page('a'),page('theirs')));
    expect(merged.pages.map(p=>p.id)).toEqual(['a','theirs','mine']);
  });
  it('retains a pure local reorder and ignores server-derived positions',()=>{
    const base=index(page('a'),page('b'),page('c'),page('d'));
    const local=index(page('b'),page('d'),page('a'),page('c'));
    const remote=index(...base.pages.map((p,i)=>({...p,position:i})));
    expect(mergeWorkspaceIndex(base,local,remote).pages.map(p=>p.id)).toEqual(['b','d','a','c']);
  });
  it('preserves concurrent insertions when a local reorder does not overlap them',()=>{
    const base=index(page('a'),page('b'),page('c'));
    const local=index(page('b'),page('a'),page('c'));
    const remote=index(page('x'),page('a'),page('b'),page('c'));
    expect(mergeWorkspaceIndex(base,local,remote).pages.map(p=>p.id)).toEqual(['x','b','a','c']);
  });
  it('rejects overlapping reorder and insertion constraints',()=>{
    expect(()=>mergeWorkspaceIndex(index(page('a'),page('b')),index(page('b'),page('a')),index(page('a'),page('x'),page('b')))).toThrow('concurrentes');
  });
  it('merges different fields on the same page',()=>{
    const merged=mergeWorkspaceIndex(index(page('a')),index(page('a',{title:'Mine'})),index(page('a',{cover:'dusk'})));
    expect(merged.pages[0]).toMatchObject({title:'Mine',cover:'dusk'});
  });
  it('rejects overlapping title changes',()=>{
    expect(()=>mergeWorkspaceIndex(index(page('a')),index(page('a',{title:'Mine'})),index(page('a',{title:'Theirs'})))).toThrow('concurrentes');
  });
  it('preserves remote deletion when local did not edit the deleted page',()=>{
    expect(mergeWorkspaceIndex(index(page('a'),page('b')),index(page('a'),page('b',{title:'Mine'})),index(page('b'))).pages).toEqual([page('b',{title:'Mine'})]);
  });
  it.each(['delete-local','delete-remote'])('rejects deletion versus concurrent edits: %s',(direction)=>{
    const base=index(page('a'),page('b'));
    const deleted={...index(page('b')),trash:[page('a')]};
    const edited=index(page('a',{title:'Edited'}),page('b'));
    expect(()=>mergeWorkspaceIndex(base,direction==='delete-local'?deleted:edited,direction==='delete-local'?edited:deleted)).toThrow('concurrentes');
  });
});
