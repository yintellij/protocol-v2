import { Artifact } from "hardhat/types";

// linkBytecode(jsonfile, {Library: lib.address})
export function linkBytecode(artifact: Artifact, libraries: Object) {
    let bytecode = artifact.bytecode;
  
    for (const [fileName, fileReferences] of Object.entries(
      artifact.linkReferences
    )) {
      for (const [libName, fixups] of Object.entries(fileReferences)) {
        // @ts-ignore
        const addr = libraries[libName];
        if (addr === undefined) {
          continue;
        }
  
        for (const fixup of fixups) {
          bytecode =
            bytecode.substr(0, 2 + fixup.start * 2) +
            addr.substr(2) +
            bytecode.substr(2 + (fixup.start + fixup.length) * 2);
        }
      }
    }
  
    return bytecode;
  }