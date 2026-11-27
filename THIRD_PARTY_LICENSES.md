# Third-party licenses

OneNote Ferry is released under the MIT License (see `LICENSE`). It includes code adapted from, or compiled together with, the projects below, which keep their own licenses.

## Obsidian Importer

- Source: https://github.com/obsidianmd/obsidian-importer (commit `fa9444a188459f227b07ec121ad03d26bd6b301a`)
- Used in: `src/core/model.ts`, `src/core/markdown.ts`, `src/core/adapter.ts` (`liftHyperlinkFields`), `src/core/render/inline.ts`, `src/core/render/page.ts`, `src/core/render/ink-svg.ts`, `src/core/cab.ts` (adapted and extended; each file says what it was adapted from)
- License: MIT

```
MIT License

Copyright (c) 2023 Obsidian

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## OfficeIMO

- Source: https://github.com/EvotecIT/OfficeIMO, by way of Obsidian Importer (above), whose Cabinet and LZX reader for `.onepkg` notebooks was ported from it
- Used in: `src/core/cab.ts` (adapted: unpacks block by block instead of reading the whole archive into memory)
- License: MIT

```
MIT License

Copyright (c) 2022 Evotec

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Joplin OneNote converter (onenote.rs)

- Source: npm package `@joplin/onenote-converter` 3.7.4 (https://github.com/laurent22/joplin, `packages/onenote-converter`, commit `898d2999f93fbedf0ce5f6626feb63e1a732ce0a`), based on https://github.com/msiemens/onenote.rs
- Used in: `parser/parser`, `parser/parser-utils`, `parser/parser-macros`, `parser/test-data` (with the changes listed in `parser/UPSTREAM.md`)
- License: Mozilla Public License 2.0, full text in `parser/LICENSE`. The files keep that license; their source is published in this repository.
- `parser/test-data/onenote-2016` carries its own license file.

## Rust crates in the WebAssembly parser

The OneNote parser in `main.js` is compiled from Rust (above) together with the crates below. Where a crate offers a choice of licenses, it is used under the one named in the last column. The license texts follow the table; each copyright notice is the one in the crate's own license files, or its listed authors where those files name none.

| Crate | Version | Copyright | License used |
| --- | --- | --- | --- |
| [addr2line](https://github.com/gimli-rs/addr2line) | 0.15.2 | Copyright (c) 2016-2018 The gimli Developers | MIT |
| [adler](https://github.com/jonas-schievink/adler) | 1.0.2 | Copyright (C) Jonas Schievink | MIT |
| [adler2](https://github.com/oyvindln/adler2) | 2.0.1 | Copyright (C) Jonas Schievink | MIT |
| [aho-corasick](https://github.com/BurntSushi/aho-corasick) | 0.7.15 | Copyright (c) 2015 Andrew Gallant | MIT |
| [approx](https://github.com/brendanzab/approx) | 0.3.2 | Copyright (c) Brendan Zabarauskas | Apache-2.0 |
| [backtrace](https://github.com/rust-lang/backtrace-rs) | 0.3.59 | Copyright (c) 2014 Alex Crichton | MIT |
| [bitflags](https://github.com/bitflags/bitflags) | 1.3.2 | Copyright (c) 2014 The Rust Project Developers | MIT |
| [bytes](https://github.com/tokio-rs/bytes) | 1.10.1 | Copyright (c) 2018 Carl Lerche | MIT |
| [cfg-if](https://github.com/alexcrichton/cfg-if) | 1.0.0 | Copyright (c) 2014 Alex Crichton | MIT |
| [color-eyre](https://github.com/yaahc/color-eyre) | 0.5.11 | Copyright (c) Jane Lusby | MIT |
| [color-spantrace](https://github.com/yaahc/color-spantrace) | 0.1.6 | Copyright (c) Jane Lusby | MIT |
| [console_error_panic_hook](https://github.com/rustwasm/console_error_panic_hook) | 0.1.7 | Copyright (c) 2018 Nick Fitzgerald | MIT |
| [crc32fast](https://github.com/srijs/rust-crc32fast) | 1.5.6 | Copyright (c) 2018 Sam Rijs, Alex Crichton and contributors | MIT |
| [deranged](https://github.com/jhpratt/deranged) | 0.5.5 | Copyright 2024 Jacob Pratt et al; Copyright (c) 2024 Jacob Pratt et al | MIT |
| [either](https://github.com/rayon-rs/either) | 1.11.0 | Copyright (c) 2015 | MIT |
| [encoding_rs](https://github.com/hsivonen/encoding_rs) | 0.8.35 | Copyright Mozilla Foundation; Copyright © WHATWG (Apple, Google, Mozilla, Microsoft) | MIT, and BSD-3-Clause for the WHATWG data |
| [eyre](https://github.com/eyre-rs/eyre) | 0.6.12 | Copyright (c) David Tolnay, Jane Lusby | MIT |
| [fdeflate](https://github.com/image-rs/fdeflate) | 0.3.7 | Copyright (c) The image-rs Developers | MIT |
| [flate2](https://github.com/rust-lang/flate2-rs) | 1.1.11 | Copyright (c) 2014-2026 Alex Crichton | MIT |
| [gimli](https://github.com/gimli-rs/gimli) | 0.24.0 | Copyright (c) 2015 The Rust Project Developers | MIT |
| [indenter](https://github.com/yaahc/indenter) | 0.3.3 | Copyright (c) Jane Lusby | MIT |
| [itertools](https://github.com/rust-itertools/itertools) | 0.10.5 | Copyright (c) 2015 | MIT |
| [itoa](https://github.com/dtolnay/itoa) | 1.0.15 | Copyright (c) David Tolnay | MIT |
| [jpeg-decoder](https://github.com/image-rs/jpeg-decoder) | 0.3.2 | Copyright (c) 2016 The jpeg-decoder Developers | MIT |
| [js-sys](https://github.com/rustwasm/wasm-bindgen/tree/master/crates/js-sys) | 0.3.77 | Copyright (c) 2014 Alex Crichton | MIT |
| [lazy_static](https://github.com/rust-lang-nursery/lazy-static.rs) | 1.4.0 | Copyright (c) 2010 The Rust Project Developers | MIT |
| [libc](https://github.com/rust-lang/libc) | 0.2.154 | Copyright (c) 2014-2020 The Rust Project Developers | MIT |
| [log](https://github.com/rust-lang/log) | 0.4.27 | Copyright (c) 2014 The Rust Project Developers | MIT |
| [memchr](https://github.com/BurntSushi/memchr) | 2.7.6 | Copyright (c) 2015 Andrew Gallant | MIT |
| [mime](https://github.com/hyperium/mime) | 0.3.17 | Copyright (c) 2014 Sean McArthur | MIT |
| [mime_guess](https://github.com/abonander/mime_guess) | 2.0.4 | Copyright (c) 2015 Austin Bonander | MIT |
| [miniz_oxide](https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide) | 0.4.4 | Copyright (c) 2017 Frommi; Copyright (c) 2020 Frommi | MIT |
| [miniz_oxide](https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide) | 0.8.9 | Copyright 2013-2014 RAD Game Tools and Valve Software; Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC; Copyright (c) 2017 Frommi; Copyright (c) 2017-2024 oyvindln; Copyright (c) 2020 Frommi | MIT |
| [miniz_oxide](https://github.com/Frommi/miniz_oxide/tree/master/miniz_oxide) | 0.9.1 | Copyright 2013-2014 RAD Game Tools and Valve Software; Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC; Copyright (c) 2017 Frommi; Copyright (c) 2017-2024 oyvindln; Copyright (c) 2020 Frommi | MIT |
| [num-conv](https://github.com/jhpratt/num-conv) | 0.1.0 | Copyright 2023 Jacob Pratt; Copyright (c) 2023 Jacob Pratt | MIT |
| [num-traits](https://github.com/rust-num/num-traits) | 0.2.19 | Copyright (c) 2014 The Rust Project Developers | MIT |
| [object](https://github.com/gimli-rs/object) | 0.24.0 | Copyright (c) 2015 The Gimli Developers | MIT |
| [once_cell](https://github.com/matklad/once_cell) | 1.19.0 | Copyright (c) Aleksey Kladov | MIT |
| [owo-colors](https://github.com/jam1garner/owo-colors) | 1.3.0 | Copyright (c) jam1garner | MIT |
| [palette](https://github.com/Ogeon/palette) | 0.5.0 | Copyright (c) 2015 Erik Hedvall | MIT |
| [phf](https://github.com/sfackler/rust-phf) | 0.8.0 | Copyright (c) Steven Fackler | MIT |
| [phf_shared](https://github.com/sfackler/rust-phf) | 0.8.0 | Copyright (c) Steven Fackler | MIT |
| [pin-project-lite](https://github.com/taiki-e/pin-project-lite) | 0.2.14 | Copyright (c) the pin-project-lite authors | MIT |
| [png](https://github.com/image-rs/image-png) | 0.17.16 | Copyright (c) 2015 nwin | MIT |
| [powerfmt](https://github.com/jhpratt/powerfmt) | 0.2.0 | Copyright 2023 Jacob Pratt et al; Copyright (c) 2023 Jacob Pratt et al | MIT |
| [regex](https://github.com/rust-lang/regex) | 1.4.6 | Copyright (c) 2014 The Rust Project Developers | MIT |
| [regex-syntax](https://github.com/rust-lang/regex) | 0.6.29 | Copyright (c) 2014 The Rust Project Developers | MIT |
| [rustc-demangle](https://github.com/alexcrichton/rustc-demangle) | 0.1.23 | Copyright (c) 2014 Alex Crichton | MIT |
| [ryu](https://github.com/dtolnay/ryu) | 1.0.17 | Copyright (c) David Tolnay | Apache-2.0 |
| [sanitize-filename](https://github.com/kardeiz/sanitize-filename) | 0.3.0 | Copyright (c) Jacob Brown | MIT |
| [serde](https://github.com/serde-rs/serde) | 1.0.200 | Copyright (c) Erick Tryzelaar, David Tolnay | MIT |
| [serde_json](https://github.com/serde-rs/json) | 1.0.143 | Copyright (c) Erick Tryzelaar, David Tolnay | MIT |
| [sha1_smol](https://github.com/mitsuhiko/sha1-smol) | 1.0.1 | Copyright (c) 2018, the respective contributors, as shown by the AUTHORS file; Copyright (c) 2006-2009 Graydon Hoare; Copyright (c) 2009-2013 Mozilla Foundation | BSD-3-Clause, and MIT for `src/simd.rs` |
| [sharded-slab](https://github.com/hawkw/sharded-slab) | 0.1.7 | Copyright (c) 2019 Eliza Weisman | MIT |
| [simd-adler32](https://github.com/mcountryman/simd-adler32) | 0.3.10 | Copyright (c) 2021 Marvin Countryman | MIT |
| [siphasher](https://github.com/jedisct1/rust-siphash) | 0.3.11 | Copyright 2012-2016 The Rust Project Developers; Copyright 2016-2023 Frank Denis | MIT |
| [thiserror](https://github.com/dtolnay/thiserror) | 1.0.69 | Copyright (c) David Tolnay | MIT |
| [thread_local](https://github.com/Amanieu/thread_local-rs) | 1.1.8 | Copyright (c) 2016 The Rust Project Developers | MIT |
| [time](https://github.com/time-rs/time) | 0.3.44 | Copyright (c) Jacob Pratt et al | MIT |
| [time-core](https://github.com/time-rs/time) | 0.1.6 | Copyright (c) Jacob Pratt et al | MIT |
| [tracing](https://github.com/tokio-rs/tracing) | 0.1.40 | Copyright (c) 2019 Tokio Contributors | MIT |
| [tracing-core](https://github.com/tokio-rs/tracing) | 0.1.32 | Copyright (c) 2019 Tokio Contributors | MIT |
| [tracing-error](https://github.com/tokio-rs/tracing) | 0.1.2 | Copyright (c) Eliza Weisman, Jane Lusby, Tokio Contributors | MIT |
| [tracing-subscriber](https://github.com/tokio-rs/tracing) | 0.2.25 | Copyright (c) 2019 Tokio Contributors | MIT |
| [unicase](https://github.com/seanmonstar/unicase) | 2.7.0 | Copyright (c) 2014-2017 Sean McArthur | MIT |
| [uuid](https://github.com/uuid-rs/uuid) | 1.8.0 | Copyright (c) 2014 The Rust Project Developers; Copyright (c) 2018 Ashley Mannix, Christopher Armstrong, Dylan DPC, Hunar Roop Kahlon | MIT |
| [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen) | 0.2.100 | Copyright (c) 2014 Alex Crichton | MIT |
| [web-sys](https://github.com/rustwasm/wasm-bindgen/tree/master/crates/web-sys) | 0.3.77 | Copyright (c) 2014 Alex Crichton | MIT |
| [widestring](https://github.com/starkat99/widestring-rs) | 1.1.0 | Copyright (c) the widestring authors | MIT |

### MIT License (crates marked MIT)

Copyright (c) the copyright holders named in the table above for each crate.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### BSD 3-Clause License (sha1_smol)

```
BSD 3-Clause License

Copyright (c) 2018, the respective contributors, as shown by the AUTHORS file.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

-----

src/simd.rs is licensed under the MIT license:

Copyright (c) 2006-2009 Graydon Hoare
Copyright (c) 2009-2013 Mozilla Foundation

Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

### BSD 3-Clause License (encoding_rs, WHATWG Encoding Standard data)

```
Copyright © WHATWG (Apple, Google, Mozilla, Microsoft).

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### Apache License 2.0 (approx, ryu)

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

## Microsoft Interop Test Suites (sample files)

- Source: https://github.com/OfficeDev/Interop-TestSuites (commit `fe87ed3253de01804a2ae6e1d0015943da6023f8`)
- Used in: `tests/samples/interop` (test input only, see `tests/samples/README.md`)
- License: MIT, full text in `tests/samples/interop/LICENSE`

## Aspose.Note FOSS for Python (sample files)

- Source: https://github.com/aspose-note-foss/Aspose.Note-FOSS-for-Python (commit `0fd1cf7bcadb279a6dd73ddcba3d5241376badd3`)
- Used in: `tests/samples/aspose` (test input only, see `tests/samples/README.md`)
- License: MIT, full text in `tests/samples/aspose/LICENSE`
