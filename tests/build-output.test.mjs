import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertBuildOutput} from '../scripts/build-output.mjs';

test('build cleanup rejects sources and ancestors, including through symlinks',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'taiwan-output-'));
  const root=join(temp,'repo');
  try {
    await mkdir(join(root,'src'),{recursive:true});
    for(const output of [temp,root,...['src','public','server','data','.git','.local','dist/nested'].map(p=>join(root,p))]) {
      await assert.rejects(assertBuildOutput(output,root),/Unsafe output/);
    }
    await assertBuildOutput(join(root,'dist'),root);
    await assertBuildOutput(join(temp,'output'),root);
    await symlink(root,join(temp,'alias'));
    await assert.rejects(assertBuildOutput(join(temp,'alias','src'),root),/Unsafe output/);
    await symlink(join(root,'src'),join(root,'dist'));
    await assert.rejects(assertBuildOutput(join(root,'dist'),root),/Unsafe output/);
  } finally {await rm(temp,{recursive:true,force:true})}
});
