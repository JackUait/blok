# [0.6.0-beta.1](https://github.com/JackUait/blok/compare/v0.5.0...v0.6.0-beta.1) (2026-02-09)


### Bug Fixes

* **api:** correct RectangleSelection type and update test mocks ([d4db69a](https://github.com/JackUait/blok/commit/d4db69a4b722fd3f51042775e3d07c750cb4b7d2))
* center toolbar icons by adding viewBox to SVGs and fixing container width ([df5ae39](https://github.com/JackUait/blok/commit/df5ae3948f5820308ee5e4096beb431f18652bb2))
* improve IconTrash proportions and silhouette ([afe5b5e](https://github.com/JackUait/blok/commit/afe5b5eda74d9249d9232a7524b0e23df86e169a))
* **lint:** address lint errors in table-cell-selection ([0abb4e2](https://github.com/JackUait/blok/commit/0abb4e29329d8922bcfae0d7b8d7531979f68ffe))
* **lint:** extract table operations to resolve max-lines error ([a34fb96](https://github.com/JackUait/blok/commit/a34fb969694a310579b57eb4c080da48717ee8cb))
* **lint:** resolve 125 ESLint warnings and errors across table tests ([c6b5a12](https://github.com/JackUait/blok/commit/c6b5a12f0b2a8f18512e9922ba23ded086701f37))
* menu displayed in the corect position ([fc16fb9](https://github.com/JackUait/blok/commit/fc16fb9b32019c854ae05ff0df6ebfd01fc97238))
* prevent toolbar jumping after cross-block selection in webkit ([366d812](https://github.com/JackUait/blok/commit/366d812330714d85934d35e5dc6160443040e187))
* refresh table controls after adding rows or columns via + buttons ([f79d84a](https://github.com/JackUait/blok/commit/f79d84ae14ba9245068828cf9e50cfbaeb1fcee1))
* **table:** add-column button now creates half-width column ([1f251be](https://github.com/JackUait/blok/commit/1f251be8c20e09c42d69f69c76f1f6a917eef99f))
* **table:** cancel RectangleSelection during cell drag ([e16e777](https://github.com/JackUait/blok/commit/e16e77715b615866604bee1a3b81ba95a43b1d0e))
* **table:** center grip pills on table border lines ([b9508c1](https://github.com/JackUait/blok/commit/b9508c11a7279066a3229bd9b532773c379d5009))
* **table:** clear programmatic selection on click-away ([87916f5](https://github.com/JackUait/blok/commit/87916f5197d03dc6d3461a37e83719c8b6fdc4cf))
* **table:** collapse cell borders ([3fd5ecc](https://github.com/JackUait/blok/commit/3fd5ecceb85936a725510e9816d036c88f9722e3))
* **table:** compensate for grid border width in selection overlay positioning ([b5d985e](https://github.com/JackUait/blok/commit/b5d985ec4f5f34d3bcb7d730efec549b98bd0570))
* **table:** correct import order for TableCellSelection ([8d58be4](https://github.com/JackUait/blok/commit/8d58be41c786be6c7a6f07027d178e05199c4a87))
* **table:** defer ensureCellHasBlock on block-removed to avoid spurious paragraphs ([c35a634](https://github.com/JackUait/blok/commit/c35a6341c6d1d23d8f36c868b547f9d4ea30c741))
* **table:** disable no-param-reassign lint rule for DOM modification ([abec94e](https://github.com/JackUait/blok/commit/abec94ed0106db22440d8ebede65f054bbfbc45b))
* **table:** extend resize handle to cover the grid top border ([4862e35](https://github.com/JackUait/blok/commit/4862e35e857c84726d2904a8bff5dab34aa9f425))
* **table:** hide add controls and close toolbar during grip drag ([a3deb23](https://github.com/JackUait/blok/commit/a3deb23ac59f4541d0f4a7c3ae6de0434b97dd78))
* **table:** hide all grip pills during row/column drag ([c7de6c0](https://github.com/JackUait/blok/commit/c7de6c0f264d918341b2e256f07fbd090156b778))
* **table:** hide resize handles and grip controls while cells are selected ([54fe590](https://github.com/JackUait/blok/commit/54fe590069821cd2cf33452349ea8f52c9a2d3dd))
* **table:** improve cell selection UX — cover grid border, disable controls during drag ([d6856ba](https://github.com/JackUait/blok/commit/d6856ba4364675cd3a9798d61597af5dee25699d))
* **table:** improve current block detection for blocks inside table cells ([0afab0a](https://github.com/JackUait/blok/commit/0afab0a66044994518b97252dce0bfb48ec5dd06))
* **table:** include left border width in grid so cell borders meet at top-right corner ([cd97362](https://github.com/JackUait/blok/commit/cd97362d1c8d71e57de6cfa8fd58eea43387ba2c))
* **table:** keep grip button visible while popover is open ([e6d48c4](https://github.com/JackUait/blok/commit/e6d48c4bd503a36afbe2854dd714e41a6a65e269))
* **table:** keep header row/column pinned to position 0 after structural changes ([21c9f19](https://github.com/JackUait/blok/commit/21c9f19e00b42e60bb93ce7d0d2f7a89e9b309da))
* **table:** mount cell blocks into cells in readonly mode ([a65ac57](https://github.com/JackUait/blok/commit/a65ac577199503bf27e3c8cc20bcfff2eb242fae))
* **table:** preserve cell content when saving in readonly mode ([dd49f02](https://github.com/JackUait/blok/commit/dd49f02562e1802bd1e731fdcd8ff71d3b209aa4))
* **table:** preserve column widths when deleting a column ([ca890d5](https://github.com/JackUait/blok/commit/ca890d5e936e93ca212ebf86bcf9bef4c8fb1ed1))
* **table:** preserve colWidths in save() so readonly mode can scroll ([48fe72d](https://github.com/JackUait/blok/commit/48fe72d8817b0fde9124e27ac3844d4a0b7dad22))
* **table:** preserve consistent grid width across edit/readonly modes ([c289d2e](https://github.com/JackUait/blok/commit/c289d2e73e363c6f54e790cad09d026f97c7c209))
* **table:** preserve empty rows during save so they survive read-only toggle ([f962331](https://github.com/JackUait/blok/commit/f96233118439672515108707f0b84d50a92f3f3f))
* **table:** preserve grip visibility when popover is open and cells are selected ([2ea08bc](https://github.com/JackUait/blok/commit/2ea08bc3b040852a3b97c06d5d87a4489bf76550))
* **table:** prevent cell text overflow in read-only mode with narrow columns ([4e3b134](https://github.com/JackUait/blok/commit/4e3b134fad514a21f94ac27a7622f8a9db6f3732))
* **table:** prevent grip controls from breaking after consecutive insertions ([b4cacba](https://github.com/JackUait/blok/commit/b4cacba7a6fd7782ec97a7a47a8a69b0512ebd28))
* **table:** prevent grip pill clipping when wrapper has overflow-x-auto ([5b46685](https://github.com/JackUait/blok/commit/5b46685a301b2450d871eccda8e97358b0d97d44))
* **table:** prevent overflow scrollbar on newly inserted tables ([6e566c6](https://github.com/JackUait/blok/commit/6e566c69db3452af02212505b383d729ff42cfba))
* **table:** prevent popover infinite recursion on close ([77dab77](https://github.com/JackUait/blok/commit/77dab772e9fafc857d794051dc292b0826894a28))
* **table:** prevent row grip clipping when wrapper has overflow-x-auto ([7a6f783](https://github.com/JackUait/blok/commit/7a6f7830d99bdb8fc172f709e1fa1c5abb9b2646))
* **table:** remove unused withHeadings block settings button and auto-size popovers ([23cdb3e](https://github.com/JackUait/blok/commit/23cdb3e4763e601e9da3e1a2cb13e66938fefed0))
* **table:** reset wrapper scroll after drag-to-remove columns ([2b6e854](https://github.com/JackUait/blok/commit/2b6e854475f2a1ad45e2be0d79b06b8c096db78f))
* **table:** resolve hover over table cells hiding block tune settings ([46d47a1](https://github.com/JackUait/blok/commit/46d47a1e0b9fef861d0c4535ec5f1a929b490ff6))
* **table:** resolve lint errors in add controls tests ([b238615](https://github.com/JackUait/blok/commit/b238615f70da24d11d6aae210256b33627c475a6))
* **table:** resolve lint errors in table-resize and index ([0106bb6](https://github.com/JackUait/blok/commit/0106bb67dc6d6c4883ce4db83af75dcd19de8190))
* **table:** resolve TypeScript errors in test files ([05fd0c6](https://github.com/JackUait/blok/commit/05fd0c64abd9d208d42ee5e8455d66f3ecc27e53))
* **table:** revert cell to plain text when nested list is removed ([63d5870](https://github.com/JackUait/blok/commit/63d5870720f3b0e2973804336ddc68c72c71340c))
* **table:** show single outer blue border for cell selection instead of per-cell rings ([245d3c4](https://github.com/JackUait/blok/commit/245d3c458049e49691aea65428e450a7dc7d1a53))
* **table:** strip placeholders from new blocks created inside table cells ([5db1e6f](https://github.com/JackUait/blok/commit/5db1e6f5f9e74c30b1930a8c350b665ca2a755ec))
* **table:** suppress paragraph placeholder in table cells ([69a1e94](https://github.com/JackUait/blok/commit/69a1e9420d24f83a7208d016d279dc59eb469d9d))
* **table:** sync add-row button width during column resize drag ([a9e8d62](https://github.com/JackUait/blok/commit/a9e8d6202136c05ddc23c592a8b8b0abe6ee26d4))
* **table:** sync add-row button width with grid when columns use pixel widths ([0eab789](https://github.com/JackUait/blok/commit/0eab7893934f66b6b4dce92f3018cb5288927f21))
* **table:** sync grid width and resize handles during drag-to-add/remove columns ([30a0a3c](https://github.com/JackUait/blok/commit/30a0a3c5111b5e77b8ed3b4774a3227ce24f95df))
* **table:** update column widths and move selection after grip menu deletion ([0760b7b](https://github.com/JackUait/blok/commit/0760b7bcdc3ba02adf6a814f698f38e5143b4f81))
* **table:** update table-core tests for resize handle in cell DOM ([f1f83d6](https://github.com/JackUait/blok/commit/f1f83d6b8f18aa1e48110f80c70b9424cd17ca0c))
* **table:** update test mocks for always-blocks cell initialization ([a5ab77d](https://github.com/JackUait/blok/commit/a5ab77d3efa634a5056bde47310292117471b93a))
* **table:** use correct block ID attribute and update E2E tests for always-blocks model ([3f1c0a7](https://github.com/JackUait/blok/commit/3f1c0a7d26a928ee1a7093838f916021aa53edc1))
* **table:** use correct tool name and mount blocks in cell ([b83d8a3](https://github.com/JackUait/blok/commit/b83d8a3c612025be99ba0473288ed58cd24f5395))
* **table:** use inline style for cell borders ([1d6c303](https://github.com/JackUait/blok/commit/1d6c3036378e2bde4b8503e0e013fdc8e4af5574))
* **table:** use overlay div for cell selection border instead of per-cell manipulation ([833f6d4](https://github.com/JackUait/blok/commit/833f6d4c2dd646f6ebd92e3a3505dc8fdca4e49e))
* **test:** dispatch mousemove event for capture phase handler test ([afa76ff](https://github.com/JackUait/blok/commit/afa76ff1685f57851d06c7a5c6b4b24eed489df3))
* **test:** update table unit tests for pointer event handlers ([e05e916](https://github.com/JackUait/blok/commit/e05e916ca6e8a8623f7acd963b02539f07918915))


### Features

* **api:** expose RectangleSelection for tool access ([4471a0e](https://github.com/JackUait/blok/commit/4471a0ebb164f990da52daa4a0834feff9e02e21))
* **playground:** redesign playground with settings panel, dark mode, and routing ([b0841d5](https://github.com/JackUait/blok/commit/b0841d5506676bed852811e17ed072d463d11903))
* **rectangleSelection:** add cancelActiveSelection API ([463165c](https://github.com/JackUait/blok/commit/463165c899eb0a665e224ca86ed2a34a81ebcab0))
* **table:** accept rectangleSelection in TableCellSelection ([6c5595c](https://github.com/JackUait/blok/commit/6c5595cc41b9a8549a5e92583f16dfbc7c58d7b1))
* **table:** add CellContent type for block-based cells ([e16fe88](https://github.com/JackUait/blok/commit/e16fe8889148423820d589ffdf1e592d06470f89))
* **table:** add colWidths field to TableData ([7cfbff7](https://github.com/JackUait/blok/commit/7cfbff799ab6520638057feac78e7c377ac17f96))
* **table:** add convertCellToBlocks method ([d927ba2](https://github.com/JackUait/blok/commit/d927ba24e9986466aa4089d11929e8e1a839e5b0))
* **table:** add data normalizer for legacy format ([c41ad29](https://github.com/JackUait/blok/commit/c41ad298a511de748968e6e9e2ff95d65b9c6a2d))
* **table:** add dot grip pattern on hover for row/column pills ([dd932b2](https://github.com/JackUait/blok/commit/dd932b2c5247c50fd664dd1be8bd664914942b3e))
* **table:** add handleCellInput for markdown trigger detection ([931c67c](https://github.com/JackUait/blok/commit/931c67c9e51b140d0c199eeeeafca2b7840a242d))
* **table:** add header row/column toggle switches to grip popovers ([5196faf](https://github.com/JackUait/blok/commit/5196fafcd4cbc8f8a5951fcef9e9fbe64b14e95a))
* **table:** add heading row support ([f09233a](https://github.com/JackUait/blok/commit/f09233a74065d2ac1d3b5dc355c2eea383b343e0))
* **table:** add hover styling for resize handles ([7f05801](https://github.com/JackUait/blok/commit/7f05801eeb331f8a5dde03a9ccfac8428a7e0ac1))
* **table:** add interactive row/column controls with grip handles ([673a20f](https://github.com/JackUait/blok/commit/673a20f3a7bba273c789dd2570569010a1586d49))
* **table:** add isInCellBlock helper for detecting nested blocks ([91ee8a7](https://github.com/JackUait/blok/commit/91ee8a7255a32d3565aa9acdcb6b40d66786d595))
* **table:** add keyboard navigation (Tab, Enter) ([4131856](https://github.com/JackUait/blok/commit/413185618b3ff1e8473df74d2bbb7cd8561d03ae))
* **table:** add keyboard navigation for cell blocks ([0e268f4](https://github.com/JackUait/blok/commit/0e268f4f07af4a3bceff78c27db94c8dac723b39))
* **table:** add markdown list trigger detection ([014f080](https://github.com/JackUait/blok/commit/014f08065ea1c67480ebaf021d18b2ac7e06dd84))
* **table:** add paste support for HTML tables ([6c730a6](https://github.com/JackUait/blok/commit/6c730a6878f71b117a1cee9b4ad88bad29c90488))
* **table:** add rectangular cell selection via click-and-drag ([ab7f3d9](https://github.com/JackUait/blok/commit/ab7f3d91e233076079ca6d64a2a90fba7dcc608b))
* **table:** add resize cursors, drag-to-remove, and tooltips for add buttons ([25fbfbe](https://github.com/JackUait/blok/commit/25fbfbe0413577dab86c4d92b8151ce557abd971))
* **table:** add resize handle elements to cells ([fb7ac86](https://github.com/JackUait/blok/commit/fb7ac864afc643c9659f2331cf8d2658bde1e26e))
* **table:** add selection pill with clear action and switch grips to dimension-based animation ([3b97fb6](https://github.com/JackUait/blok/commit/3b97fb604cc702af432b19785d0669fa1f3983f5))
* **table:** add smooth opacity animation for resize handle ([6ae7fdc](https://github.com/JackUait/blok/commit/6ae7fdcd9d8fb01dd8505fd5bb19dccf9aaa5474))
* **table:** add Table class skeleton with render and save ([72653ff](https://github.com/JackUait/blok/commit/72653ff5660ea12f1df8fef33e2b8bec57f63a35))
* **table:** add table icon ([ee613f1](https://github.com/JackUait/blok/commit/ee613f12026555da639819414a6b3c4ad690f3ef))
* **table:** add TableAddControls class with hover-to-reveal + buttons ([5948dee](https://github.com/JackUait/blok/commit/5948deeda4f33e877a062ca34242a12bf1f117ce))
* **table:** add TableCellBlocks class with focus tracking ([9589de5](https://github.com/JackUait/blok/commit/9589de543f89f361bb56b7f6f43e4dc706470f54))
* **table:** add TableGrid core with row/column operations ([004392c](https://github.com/JackUait/blok/commit/004392c5016c375ad8c83ef9b4f2ff5334aa63c3))
* **table:** add type definitions ([ad7ebf0](https://github.com/JackUait/blok/commit/ad7ebf0fa6a9003aefc652499f1e468dd49fb24e))
* **table:** add wrapper padding for add controls overflow ([6597f9a](https://github.com/JackUait/blok/commit/6597f9aa42d40914842793e675aaaebad3e6b346))
* **table:** capture drag from RectangleSelection ([cf26f2f](https://github.com/JackUait/blok/commit/cf26f2f3dd2dd61cb0e990b1ac61bc42fcd29f8d))
* **table:** change default grid size to 3x3 ([8639991](https://github.com/JackUait/blok/commit/863999101614dfb31a9a42c81e1c8182848da3cd))
* **table:** drag add-row/column buttons to add multiple rows/columns ([14a0e2b](https://github.com/JackUait/blok/commit/14a0e2b7c1809b34834ce8f8d425fe2fa767d247))
* **table:** enforce max rows and columns limits ([f997cae](https://github.com/JackUait/blok/commit/f997cae3b3b65a17a439c17e4c235c36f2339793))
* **table:** ensure cells always have at least one paragraph block ([084e61d](https://github.com/JackUait/blok/commit/084e61d0a39ba6e92fa78817b04bda958be0918a))
* **table:** expand sanitizer to allow list elements ([5a6203d](https://github.com/JackUait/blok/commit/5a6203d7359a39ed099ffddb3232937bf7f5c2fe))
* **table:** export Table tool from tools index ([54085be](https://github.com/JackUait/blok/commit/54085be2c3ec5e3153960ebc5f6a9ad8a7db92b9))
* **table:** export Table tool types for consumers ([06b1c08](https://github.com/JackUait/blok/commit/06b1c0826c532327ca8f5182398d4350266ad2c9))
* **table:** handle block cleanup on row/column delete ([439758f](https://github.com/JackUait/blok/commit/439758fda0ecd4b286ace40c3202c3e6d479911e))
* **table:** hide block toolbar for blocks inside table cells ([631a511](https://github.com/JackUait/blok/commit/631a511b79d9d32de76a99b0d2cf5f394812a9e6))
* **table:** hide controls during drag-to-add/remove rows and columns ([1127ff2](https://github.com/JackUait/blok/commit/1127ff2cb1d131170619369160b98d24eec54f72))
* **table:** highlight newly inserted row/column after grip menu action ([6eec7cd](https://github.com/JackUait/blok/commit/6eec7cd6543552a983e53b43164b60cf88886164))
* **table:** highlight row/column on grip click, improve overlay border coverage ([9d0fecd](https://github.com/JackUait/blok/commit/9d0fecde40c80120e641bee75345cac15e367500))
* **table:** implement TableResize class for column drag resize ([3132150](https://github.com/JackUait/blok/commit/31321505e23db4219e756b355288bd11cb10276e))
* **table:** improve drag-to-reorder UX and interaction polish ([721bb3f](https://github.com/JackUait/blok/commit/721bb3f5a5020b03cd48ae422e694bc4cd08ac12))
* **table:** initialize all cells with paragraph blocks on creation and load ([b5ac5da](https://github.com/JackUait/blok/commit/b5ac5dac4cb4c1e92e38d61bff1ea29da53b5583))
* **table:** integrate add row/column controls into Table tool ([b092b8d](https://github.com/JackUait/blok/commit/b092b8d2733f298dd2bd9dcf5b2971627ace5ebe))
* **table:** integrate pixel-based resize, init in rendered() lifecycle ([d993d35](https://github.com/JackUait/blok/commit/d993d351a5d282d1ec03e0224e530bd677e6fb65))
* **table:** integrate TableCellBlocks into Table tool ([74d03c0](https://github.com/JackUait/blok/commit/74d03c06039803edf41a48ed716743ebd7be00d4))
* **table:** intercept block-added events to mount new blocks in cells ([6660d69](https://github.com/JackUait/blok/commit/6660d696ad87bcf6c889535f15dfdaced836fd3d))
* **table:** new columns are half-width and cells use reduced vertical padding ([8dd7d08](https://github.com/JackUait/blok/commit/8dd7d0860a1c43537aa3369b65d2fb0183643284))
* **table:** new rows and columns get cells with paragraph blocks ([66185b9](https://github.com/JackUait/blok/commit/66185b9ba8cae4f13bce251f25fcb4908f8bbf3c))
* **table:** preserve column widths when adding columns and enable horizontal scroll ([0dae4f7](https://github.com/JackUait/blok/commit/0dae4f7ee16174ed19fdbc71070e96f3e5c27361))
* **table:** prevent drag-to-remove of rows/columns with content ([1128579](https://github.com/JackUait/blok/commit/11285795db6ce7f134e2698e9dcf48c9900b3473))
* **table:** replace grip handles with pill controls and add cell focus border ([9299789](https://github.com/JackUait/blok/commit/929978949f9929515df9a68fbcc1434f727256fb))
* **table:** replace move menu items with drag-to-reorder enhancements ([e156b34](https://github.com/JackUait/blok/commit/e156b344eda77d89bc01a9897b5d98a014c4832d)), closes [#dbeafe](https://github.com/JackUait/blok/issues/dbeafe)
* **table:** replace native title tooltips with styled custom tooltips on add buttons ([b738c8a](https://github.com/JackUait/blok/commit/b738c8a0bb0b9a38d9bb22ac45185b3879f43991))
* **table:** rewrite TableResize to single-column pixel-based drag ([d9da52b](https://github.com/JackUait/blok/commit/d9da52bfd95cfe8dfe7a0514b74583e43b25b9ad))
* **table:** right-edge handle controls table width instead of column ratios ([44b7648](https://github.com/JackUait/blok/commit/44b7648caa26b2c73431d1ab17c16b2da372cab2))
* **table:** show row/column grip controls on hover instead of focus ([4b55066](https://github.com/JackUait/blok/commit/4b55066ff3e9977386287bfc7fc919d99542ba59))
* **table:** skip list Tab handling inside table cells for cell navigation ([14a8e5d](https://github.com/JackUait/blok/commit/14a8e5d8e083ceb53afc6379a2ae36afcdabe470))
* **table:** support any block type in table cells ([cae27dc](https://github.com/JackUait/blok/commit/cae27dc87c3fb4b1cd7cc092dd60a12d98e2138b))
* **table:** support explicit column widths as percentages ([dcdc77b](https://github.com/JackUait/blok/commit/dcdc77ba21e8335cbc30074b0379aa64dc24082b))
* **table:** Tab/Shift+Tab navigates between cell blocks ([5453c31](https://github.com/JackUait/blok/commit/5453c31f44d23ae5fd3322d0a7918883e1c64572))
* **table:** update TableGrid to handle block-based cells ([c7866a3](https://github.com/JackUait/blok/commit/c7866a3c9a42a35ba53637a06c89e86e289c968a))
* **table:** wire keyboard navigation into Table class ([0c28991](https://github.com/JackUait/blok/commit/0c289916e72c148cc505506568fd7f28431626ac))
* **table:** wire RectangleSelection to TableCellSelection ([4d89e77](https://github.com/JackUait/blok/commit/4d89e77b661d88384fcc77f4b2896fda0b38c7cf))
* **table:** wire TableResize into Table class ([4499697](https://github.com/JackUait/blok/commit/449969782e84d510774bfa425e0daa541d3854bc))
* **tooltip:** remove animation from tooltips for instant show/hide ([54b6195](https://github.com/JackUait/blok/commit/54b6195fbca35e63fb8436c79dd268a2fc0b5cf7))


### Performance Improvements

* **table:** use GPU-accelerated scale transforms for grip expand animation ([155623a](https://github.com/JackUait/blok/commit/155623a8da98149845ba9db54c1e9b68e8574e58))

# [0.6.0-beta.1](https://github.com/JackUait/blok/compare/v0.5.0...v0.6.0-beta.1) (2026-02-09)


### Bug Fixes

* **api:** correct RectangleSelection type and update test mocks ([d4db69a](https://github.com/JackUait/blok/commit/d4db69a4b722fd3f51042775e3d07c750cb4b7d2))
* center toolbar icons by adding viewBox to SVGs and fixing container width ([df5ae39](https://github.com/JackUait/blok/commit/df5ae3948f5820308ee5e4096beb431f18652bb2))
* improve IconTrash proportions and silhouette ([afe5b5e](https://github.com/JackUait/blok/commit/afe5b5eda74d9249d9232a7524b0e23df86e169a))
* **lint:** address lint errors in table-cell-selection ([0abb4e2](https://github.com/JackUait/blok/commit/0abb4e29329d8922bcfae0d7b8d7531979f68ffe))
* **lint:** extract table operations to resolve max-lines error ([a34fb96](https://github.com/JackUait/blok/commit/a34fb969694a310579b57eb4c080da48717ee8cb))
* **lint:** resolve 125 ESLint warnings and errors across table tests ([c6b5a12](https://github.com/JackUait/blok/commit/c6b5a12f0b2a8f18512e9922ba23ded086701f37))
* menu displayed in the corect position ([fc16fb9](https://github.com/JackUait/blok/commit/fc16fb9b32019c854ae05ff0df6ebfd01fc97238))
* prevent toolbar jumping after cross-block selection in webkit ([366d812](https://github.com/JackUait/blok/commit/366d812330714d85934d35e5dc6160443040e187))
* refresh table controls after adding rows or columns via + buttons ([f79d84a](https://github.com/JackUait/blok/commit/f79d84ae14ba9245068828cf9e50cfbaeb1fcee1))
* **table:** add-column button now creates half-width column ([1f251be](https://github.com/JackUait/blok/commit/1f251be8c20e09c42d69f69c76f1f6a917eef99f))
* **table:** cancel RectangleSelection during cell drag ([e16e777](https://github.com/JackUait/blok/commit/e16e77715b615866604bee1a3b81ba95a43b1d0e))
* **table:** center grip pills on table border lines ([b9508c1](https://github.com/JackUait/blok/commit/b9508c11a7279066a3229bd9b532773c379d5009))
* **table:** clear programmatic selection on click-away ([87916f5](https://github.com/JackUait/blok/commit/87916f5197d03dc6d3461a37e83719c8b6fdc4cf))
* **table:** collapse cell borders ([3fd5ecc](https://github.com/JackUait/blok/commit/3fd5ecceb85936a725510e9816d036c88f9722e3))
* **table:** compensate for grid border width in selection overlay positioning ([b5d985e](https://github.com/JackUait/blok/commit/b5d985ec4f5f34d3bcb7d730efec549b98bd0570))
* **table:** correct import order for TableCellSelection ([8d58be4](https://github.com/JackUait/blok/commit/8d58be41c786be6c7a6f07027d178e05199c4a87))
* **table:** defer ensureCellHasBlock on block-removed to avoid spurious paragraphs ([c35a634](https://github.com/JackUait/blok/commit/c35a6341c6d1d23d8f36c868b547f9d4ea30c741))
* **table:** disable no-param-reassign lint rule for DOM modification ([abec94e](https://github.com/JackUait/blok/commit/abec94ed0106db22440d8ebede65f054bbfbc45b))
* **table:** extend resize handle to cover the grid top border ([4862e35](https://github.com/JackUait/blok/commit/4862e35e857c84726d2904a8bff5dab34aa9f425))
* **table:** hide add controls and close toolbar during grip drag ([a3deb23](https://github.com/JackUait/blok/commit/a3deb23ac59f4541d0f4a7c3ae6de0434b97dd78))
* **table:** hide all grip pills during row/column drag ([c7de6c0](https://github.com/JackUait/blok/commit/c7de6c0f264d918341b2e256f07fbd090156b778))
* **table:** hide resize handles and grip controls while cells are selected ([54fe590](https://github.com/JackUait/blok/commit/54fe590069821cd2cf33452349ea8f52c9a2d3dd))
* **table:** improve cell selection UX — cover grid border, disable controls during drag ([d6856ba](https://github.com/JackUait/blok/commit/d6856ba4364675cd3a9798d61597af5dee25699d))
* **table:** improve current block detection for blocks inside table cells ([0afab0a](https://github.com/JackUait/blok/commit/0afab0a66044994518b97252dce0bfb48ec5dd06))
* **table:** include left border width in grid so cell borders meet at top-right corner ([cd97362](https://github.com/JackUait/blok/commit/cd97362d1c8d71e57de6cfa8fd58eea43387ba2c))
* **table:** keep grip button visible while popover is open ([e6d48c4](https://github.com/JackUait/blok/commit/e6d48c4bd503a36afbe2854dd714e41a6a65e269))
* **table:** keep header row/column pinned to position 0 after structural changes ([21c9f19](https://github.com/JackUait/blok/commit/21c9f19e00b42e60bb93ce7d0d2f7a89e9b309da))
* **table:** mount cell blocks into cells in readonly mode ([a65ac57](https://github.com/JackUait/blok/commit/a65ac577199503bf27e3c8cc20bcfff2eb242fae))
* **table:** preserve cell content when saving in readonly mode ([dd49f02](https://github.com/JackUait/blok/commit/dd49f02562e1802bd1e731fdcd8ff71d3b209aa4))
* **table:** preserve column widths when deleting a column ([ca890d5](https://github.com/JackUait/blok/commit/ca890d5e936e93ca212ebf86bcf9bef4c8fb1ed1))
* **table:** preserve colWidths in save() so readonly mode can scroll ([48fe72d](https://github.com/JackUait/blok/commit/48fe72d8817b0fde9124e27ac3844d4a0b7dad22))
* **table:** preserve consistent grid width across edit/readonly modes ([c289d2e](https://github.com/JackUait/blok/commit/c289d2e73e363c6f54e790cad09d026f97c7c209))
* **table:** preserve empty rows during save so they survive read-only toggle ([f962331](https://github.com/JackUait/blok/commit/f96233118439672515108707f0b84d50a92f3f3f))
* **table:** preserve grip visibility when popover is open and cells are selected ([2ea08bc](https://github.com/JackUait/blok/commit/2ea08bc3b040852a3b97c06d5d87a4489bf76550))
* **table:** prevent cell text overflow in read-only mode with narrow columns ([4e3b134](https://github.com/JackUait/blok/commit/4e3b134fad514a21f94ac27a7622f8a9db6f3732))
* **table:** prevent grip controls from breaking after consecutive insertions ([b4cacba](https://github.com/JackUait/blok/commit/b4cacba7a6fd7782ec97a7a47a8a69b0512ebd28))
* **table:** prevent grip pill clipping when wrapper has overflow-x-auto ([5b46685](https://github.com/JackUait/blok/commit/5b46685a301b2450d871eccda8e97358b0d97d44))
* **table:** prevent overflow scrollbar on newly inserted tables ([6e566c6](https://github.com/JackUait/blok/commit/6e566c69db3452af02212505b383d729ff42cfba))
* **table:** prevent popover infinite recursion on close ([77dab77](https://github.com/JackUait/blok/commit/77dab772e9fafc857d794051dc292b0826894a28))
* **table:** prevent row grip clipping when wrapper has overflow-x-auto ([7a6f783](https://github.com/JackUait/blok/commit/7a6f7830d99bdb8fc172f709e1fa1c5abb9b2646))
* **table:** remove unused withHeadings block settings button and auto-size popovers ([23cdb3e](https://github.com/JackUait/blok/commit/23cdb3e4763e601e9da3e1a2cb13e66938fefed0))
* **table:** reset wrapper scroll after drag-to-remove columns ([2b6e854](https://github.com/JackUait/blok/commit/2b6e854475f2a1ad45e2be0d79b06b8c096db78f))
* **table:** resolve hover over table cells hiding block tune settings ([46d47a1](https://github.com/JackUait/blok/commit/46d47a1e0b9fef861d0c4535ec5f1a929b490ff6))
* **table:** resolve lint errors in add controls tests ([b238615](https://github.com/JackUait/blok/commit/b238615f70da24d11d6aae210256b33627c475a6))
* **table:** resolve lint errors in table-resize and index ([0106bb6](https://github.com/JackUait/blok/commit/0106bb67dc6d6c4883ce4db83af75dcd19de8190))
* **table:** resolve TypeScript errors in test files ([05fd0c6](https://github.com/JackUait/blok/commit/05fd0c64abd9d208d42ee5e8455d66f3ecc27e53))
* **table:** revert cell to plain text when nested list is removed ([63d5870](https://github.com/JackUait/blok/commit/63d5870720f3b0e2973804336ddc68c72c71340c))
* **table:** show single outer blue border for cell selection instead of per-cell rings ([245d3c4](https://github.com/JackUait/blok/commit/245d3c458049e49691aea65428e450a7dc7d1a53))
* **table:** strip placeholders from new blocks created inside table cells ([5db1e6f](https://github.com/JackUait/blok/commit/5db1e6f5f9e74c30b1930a8c350b665ca2a755ec))
* **table:** suppress paragraph placeholder in table cells ([69a1e94](https://github.com/JackUait/blok/commit/69a1e9420d24f83a7208d016d279dc59eb469d9d))
* **table:** sync add-row button width during column resize drag ([a9e8d62](https://github.com/JackUait/blok/commit/a9e8d6202136c05ddc23c592a8b8b0abe6ee26d4))
* **table:** sync add-row button width with grid when columns use pixel widths ([0eab789](https://github.com/JackUait/blok/commit/0eab7893934f66b6b4dce92f3018cb5288927f21))
* **table:** sync grid width and resize handles during drag-to-add/remove columns ([30a0a3c](https://github.com/JackUait/blok/commit/30a0a3c5111b5e77b8ed3b4774a3227ce24f95df))
* **table:** update column widths and move selection after grip menu deletion ([0760b7b](https://github.com/JackUait/blok/commit/0760b7bcdc3ba02adf6a814f698f38e5143b4f81))
* **table:** update table-core tests for resize handle in cell DOM ([f1f83d6](https://github.com/JackUait/blok/commit/f1f83d6b8f18aa1e48110f80c70b9424cd17ca0c))
* **table:** update test mocks for always-blocks cell initialization ([a5ab77d](https://github.com/JackUait/blok/commit/a5ab77d3efa634a5056bde47310292117471b93a))
* **table:** use correct block ID attribute and update E2E tests for always-blocks model ([3f1c0a7](https://github.com/JackUait/blok/commit/3f1c0a7d26a928ee1a7093838f916021aa53edc1))
* **table:** use correct tool name and mount blocks in cell ([b83d8a3](https://github.com/JackUait/blok/commit/b83d8a3c612025be99ba0473288ed58cd24f5395))
* **table:** use inline style for cell borders ([1d6c303](https://github.com/JackUait/blok/commit/1d6c3036378e2bde4b8503e0e013fdc8e4af5574))
* **table:** use overlay div for cell selection border instead of per-cell manipulation ([833f6d4](https://github.com/JackUait/blok/commit/833f6d4c2dd646f6ebd92e3a3505dc8fdca4e49e))
* **test:** dispatch mousemove event for capture phase handler test ([afa76ff](https://github.com/JackUait/blok/commit/afa76ff1685f57851d06c7a5c6b4b24eed489df3))
* **test:** update table unit tests for pointer event handlers ([e05e916](https://github.com/JackUait/blok/commit/e05e916ca6e8a8623f7acd963b02539f07918915))


### Features

* **api:** expose RectangleSelection for tool access ([4471a0e](https://github.com/JackUait/blok/commit/4471a0ebb164f990da52daa4a0834feff9e02e21))
* **playground:** redesign playground with settings panel, dark mode, and routing ([b0841d5](https://github.com/JackUait/blok/commit/b0841d5506676bed852811e17ed072d463d11903))
* **rectangleSelection:** add cancelActiveSelection API ([463165c](https://github.com/JackUait/blok/commit/463165c899eb0a665e224ca86ed2a34a81ebcab0))
* **table:** accept rectangleSelection in TableCellSelection ([6c5595c](https://github.com/JackUait/blok/commit/6c5595cc41b9a8549a5e92583f16dfbc7c58d7b1))
* **table:** add CellContent type for block-based cells ([e16fe88](https://github.com/JackUait/blok/commit/e16fe8889148423820d589ffdf1e592d06470f89))
* **table:** add colWidths field to TableData ([7cfbff7](https://github.com/JackUait/blok/commit/7cfbff799ab6520638057feac78e7c377ac17f96))
* **table:** add convertCellToBlocks method ([d927ba2](https://github.com/JackUait/blok/commit/d927ba24e9986466aa4089d11929e8e1a839e5b0))
* **table:** add data normalizer for legacy format ([c41ad29](https://github.com/JackUait/blok/commit/c41ad298a511de748968e6e9e2ff95d65b9c6a2d))
* **table:** add dot grip pattern on hover for row/column pills ([dd932b2](https://github.com/JackUait/blok/commit/dd932b2c5247c50fd664dd1be8bd664914942b3e))
* **table:** add handleCellInput for markdown trigger detection ([931c67c](https://github.com/JackUait/blok/commit/931c67c9e51b140d0c199eeeeafca2b7840a242d))
* **table:** add header row/column toggle switches to grip popovers ([5196faf](https://github.com/JackUait/blok/commit/5196fafcd4cbc8f8a5951fcef9e9fbe64b14e95a))
* **table:** add heading row support ([f09233a](https://github.com/JackUait/blok/commit/f09233a74065d2ac1d3b5dc355c2eea383b343e0))
* **table:** add hover styling for resize handles ([7f05801](https://github.com/JackUait/blok/commit/7f05801eeb331f8a5dde03a9ccfac8428a7e0ac1))
* **table:** add interactive row/column controls with grip handles ([673a20f](https://github.com/JackUait/blok/commit/673a20f3a7bba273c789dd2570569010a1586d49))
* **table:** add isInCellBlock helper for detecting nested blocks ([91ee8a7](https://github.com/JackUait/blok/commit/91ee8a7255a32d3565aa9acdcb6b40d66786d595))
* **table:** add keyboard navigation (Tab, Enter) ([4131856](https://github.com/JackUait/blok/commit/413185618b3ff1e8473df74d2bbb7cd8561d03ae))
* **table:** add keyboard navigation for cell blocks ([0e268f4](https://github.com/JackUait/blok/commit/0e268f4f07af4a3bceff78c27db94c8dac723b39))
* **table:** add markdown list trigger detection ([014f080](https://github.com/JackUait/blok/commit/014f08065ea1c67480ebaf021d18b2ac7e06dd84))
* **table:** add paste support for HTML tables ([6c730a6](https://github.com/JackUait/blok/commit/6c730a6878f71b117a1cee9b4ad88bad29c90488))
* **table:** add rectangular cell selection via click-and-drag ([ab7f3d9](https://github.com/JackUait/blok/commit/ab7f3d91e233076079ca6d64a2a90fba7dcc608b))
* **table:** add resize cursors, drag-to-remove, and tooltips for add buttons ([25fbfbe](https://github.com/JackUait/blok/commit/25fbfbe0413577dab86c4d92b8151ce557abd971))
* **table:** add resize handle elements to cells ([fb7ac86](https://github.com/JackUait/blok/commit/fb7ac864afc643c9659f2331cf8d2658bde1e26e))
* **table:** add selection pill with clear action and switch grips to dimension-based animation ([3b97fb6](https://github.com/JackUait/blok/commit/3b97fb604cc702af432b19785d0669fa1f3983f5))
* **table:** add smooth opacity animation for resize handle ([6ae7fdc](https://github.com/JackUait/blok/commit/6ae7fdcd9d8fb01dd8505fd5bb19dccf9aaa5474))
* **table:** add Table class skeleton with render and save ([72653ff](https://github.com/JackUait/blok/commit/72653ff5660ea12f1df8fef33e2b8bec57f63a35))
* **table:** add table icon ([ee613f1](https://github.com/JackUait/blok/commit/ee613f12026555da639819414a6b3c4ad690f3ef))
* **table:** add TableAddControls class with hover-to-reveal + buttons ([5948dee](https://github.com/JackUait/blok/commit/5948deeda4f33e877a062ca34242a12bf1f117ce))
* **table:** add TableCellBlocks class with focus tracking ([9589de5](https://github.com/JackUait/blok/commit/9589de543f89f361bb56b7f6f43e4dc706470f54))
* **table:** add TableGrid core with row/column operations ([004392c](https://github.com/JackUait/blok/commit/004392c5016c375ad8c83ef9b4f2ff5334aa63c3))
* **table:** add type definitions ([ad7ebf0](https://github.com/JackUait/blok/commit/ad7ebf0fa6a9003aefc652499f1e468dd49fb24e))
* **table:** add wrapper padding for add controls overflow ([6597f9a](https://github.com/JackUait/blok/commit/6597f9aa42d40914842793e675aaaebad3e6b346))
* **table:** capture drag from RectangleSelection ([cf26f2f](https://github.com/JackUait/blok/commit/cf26f2f3dd2dd61cb0e990b1ac61bc42fcd29f8d))
* **table:** change default grid size to 3x3 ([8639991](https://github.com/JackUait/blok/commit/863999101614dfb31a9a42c81e1c8182848da3cd))
* **table:** drag add-row/column buttons to add multiple rows/columns ([14a0e2b](https://github.com/JackUait/blok/commit/14a0e2b7c1809b34834ce8f8d425fe2fa767d247))
* **table:** enforce max rows and columns limits ([f997cae](https://github.com/JackUait/blok/commit/f997cae3b3b65a17a439c17e4c235c36f2339793))
* **table:** ensure cells always have at least one paragraph block ([084e61d](https://github.com/JackUait/blok/commit/084e61d0a39ba6e92fa78817b04bda958be0918a))
* **table:** expand sanitizer to allow list elements ([5a6203d](https://github.com/JackUait/blok/commit/5a6203d7359a39ed099ffddb3232937bf7f5c2fe))
* **table:** export Table tool from tools index ([54085be](https://github.com/JackUait/blok/commit/54085be2c3ec5e3153960ebc5f6a9ad8a7db92b9))
* **table:** export Table tool types for consumers ([06b1c08](https://github.com/JackUait/blok/commit/06b1c0826c532327ca8f5182398d4350266ad2c9))
* **table:** handle block cleanup on row/column delete ([439758f](https://github.com/JackUait/blok/commit/439758fda0ecd4b286ace40c3202c3e6d479911e))
* **table:** hide block toolbar for blocks inside table cells ([631a511](https://github.com/JackUait/blok/commit/631a511b79d9d32de76a99b0d2cf5f394812a9e6))
* **table:** hide controls during drag-to-add/remove rows and columns ([1127ff2](https://github.com/JackUait/blok/commit/1127ff2cb1d131170619369160b98d24eec54f72))
* **table:** highlight newly inserted row/column after grip menu action ([6eec7cd](https://github.com/JackUait/blok/commit/6eec7cd6543552a983e53b43164b60cf88886164))
* **table:** highlight row/column on grip click, improve overlay border coverage ([9d0fecd](https://github.com/JackUait/blok/commit/9d0fecde40c80120e641bee75345cac15e367500))
* **table:** implement TableResize class for column drag resize ([3132150](https://github.com/JackUait/blok/commit/31321505e23db4219e756b355288bd11cb10276e))
* **table:** improve drag-to-reorder UX and interaction polish ([721bb3f](https://github.com/JackUait/blok/commit/721bb3f5a5020b03cd48ae422e694bc4cd08ac12))
* **table:** initialize all cells with paragraph blocks on creation and load ([b5ac5da](https://github.com/JackUait/blok/commit/b5ac5dac4cb4c1e92e38d61bff1ea29da53b5583))
* **table:** integrate add row/column controls into Table tool ([b092b8d](https://github.com/JackUait/blok/commit/b092b8d2733f298dd2bd9dcf5b2971627ace5ebe))
* **table:** integrate pixel-based resize, init in rendered() lifecycle ([d993d35](https://github.com/JackUait/blok/commit/d993d351a5d282d1ec03e0224e530bd677e6fb65))
* **table:** integrate TableCellBlocks into Table tool ([74d03c0](https://github.com/JackUait/blok/commit/74d03c06039803edf41a48ed716743ebd7be00d4))
* **table:** intercept block-added events to mount new blocks in cells ([6660d69](https://github.com/JackUait/blok/commit/6660d696ad87bcf6c889535f15dfdaced836fd3d))
* **table:** new columns are half-width and cells use reduced vertical padding ([8dd7d08](https://github.com/JackUait/blok/commit/8dd7d0860a1c43537aa3369b65d2fb0183643284))
* **table:** new rows and columns get cells with paragraph blocks ([66185b9](https://github.com/JackUait/blok/commit/66185b9ba8cae4f13bce251f25fcb4908f8bbf3c))
* **table:** preserve column widths when adding columns and enable horizontal scroll ([0dae4f7](https://github.com/JackUait/blok/commit/0dae4f7ee16174ed19fdbc71070e96f3e5c27361))
* **table:** prevent drag-to-remove of rows/columns with content ([1128579](https://github.com/JackUait/blok/commit/11285795db6ce7f134e2698e9dcf48c9900b3473))
* **table:** replace grip handles with pill controls and add cell focus border ([9299789](https://github.com/JackUait/blok/commit/929978949f9929515df9a68fbcc1434f727256fb))
* **table:** replace move menu items with drag-to-reorder enhancements ([e156b34](https://github.com/JackUait/blok/commit/e156b344eda77d89bc01a9897b5d98a014c4832d)), closes [#dbeafe](https://github.com/JackUait/blok/issues/dbeafe)
* **table:** replace native title tooltips with styled custom tooltips on add buttons ([b738c8a](https://github.com/JackUait/blok/commit/b738c8a0bb0b9a38d9bb22ac45185b3879f43991))
* **table:** rewrite TableResize to single-column pixel-based drag ([d9da52b](https://github.com/JackUait/blok/commit/d9da52bfd95cfe8dfe7a0514b74583e43b25b9ad))
* **table:** right-edge handle controls table width instead of column ratios ([44b7648](https://github.com/JackUait/blok/commit/44b7648caa26b2c73431d1ab17c16b2da372cab2))
* **table:** show row/column grip controls on hover instead of focus ([4b55066](https://github.com/JackUait/blok/commit/4b55066ff3e9977386287bfc7fc919d99542ba59))
* **table:** skip list Tab handling inside table cells for cell navigation ([14a8e5d](https://github.com/JackUait/blok/commit/14a8e5d8e083ceb53afc6379a2ae36afcdabe470))
* **table:** support any block type in table cells ([cae27dc](https://github.com/JackUait/blok/commit/cae27dc87c3fb4b1cd7cc092dd60a12d98e2138b))
* **table:** support explicit column widths as percentages ([dcdc77b](https://github.com/JackUait/blok/commit/dcdc77ba21e8335cbc30074b0379aa64dc24082b))
* **table:** Tab/Shift+Tab navigates between cell blocks ([5453c31](https://github.com/JackUait/blok/commit/5453c31f44d23ae5fd3322d0a7918883e1c64572))
* **table:** update TableGrid to handle block-based cells ([c7866a3](https://github.com/JackUait/blok/commit/c7866a3c9a42a35ba53637a06c89e86e289c968a))
* **table:** wire keyboard navigation into Table class ([0c28991](https://github.com/JackUait/blok/commit/0c289916e72c148cc505506568fd7f28431626ac))
* **table:** wire RectangleSelection to TableCellSelection ([4d89e77](https://github.com/JackUait/blok/commit/4d89e77b661d88384fcc77f4b2896fda0b38c7cf))
* **table:** wire TableResize into Table class ([4499697](https://github.com/JackUait/blok/commit/449969782e84d510774bfa425e0daa541d3854bc))
* **tooltip:** remove animation from tooltips for instant show/hide ([54b6195](https://github.com/JackUait/blok/commit/54b6195fbca35e63fb8436c79dd268a2fc0b5cf7))


### Performance Improvements

* **table:** use GPU-accelerated scale transforms for grip expand animation ([155623a](https://github.com/JackUait/blok/commit/155623a8da98149845ba9db54c1e9b68e8574e58))

# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0](https://github.com/JackUait/blok/compare/v0.4.1-beta.5...v0.5.0) (2026-01-23)

### ✨ Features

- implement Conflict-Free Replicated Data Type (CRDT) undo/redo ([#33](https://github.com/JackUait/blok/pull/33)) ([98477264](https://github.com/JackUait/blok/commit/984772642af711dcbe23d06f14ed77c003012ecc))
- handle edge cases when converting lists in old format to lists in new format ([594f3ba7](https://github.com/JackUait/blok/commit/594f3ba77cee0a08bcf5f46bb8251e41d857ea8e))
- add convertion from the old data model to the new data model for lists ([a87c21b7](https://github.com/JackUait/blok/commit/a87c21b71344e3620bb7fcd6e621730de8442363))

### 🐛 Bug Fixes

- toolbar hover behavior after cross-block selection ([#35](https://github.com/JackUait/blok/pull/35)) ([122a50fc](https://github.com/JackUait/blok/commit/122a50fcdabee2e7003c8f464701ecc35e4fc9af))
- trigger PatternPasteEvent for internal cut/paste operations ([d98fd369](https://github.com/JackUait/blok/commit/d98fd36951cd5824d728ddb006572d071f6e8650))
- bundle size bugs ([6a0f760b](https://github.com/JackUait/blok/commit/6a0f760bba5b490c2a2785c853154620b7b32e7b))

### 🔧 CI/CD

- fix bundle size tracking ([#32](https://github.com/JackUait/blok/pull/32)) ([655691fd](https://github.com/JackUait/blok/commit/655691fde852d28cc9ec0c4e9e539ffd25f3ff4c))
- improve E2E runtime with parallel sharding and PR reporting ([#29](https://github.com/JackUait/blok/pull/29)) ([c4a29f1b](https://github.com/JackUait/blok/commit/c4a29f1bb4b7106ad9475ab5074b57ae10c14356))

### ♻️ Refactoring

- decouple files to reduce their complexity ([#34](https://github.com/JackUait/blok/pull/34)) ([55b77ce7](https://github.com/JackUait/blok/commit/55b77ce7140ec4cc08bec83861ac36bce244086c))
- reduce bundle size ([#30](https://github.com/JackUait/blok/pull/30)) ([c437a8be](https://github.com/JackUait/blok/commit/c437a8be38290ca1d0a5ac0d1f7978a414df2540))
- improve publishing ([#28](https://github.com/JackUait/blok/pull/28)) ([9b32f5ba](https://github.com/JackUait/blok/commit/9b32f5ba4274af4d9b51287fff8e6bcb27ca75f5))

### 🧹 Chores

- update storybook-related dependencies ([b5fb5313](https://github.com/JackUait/blok/commit/b5fb531379b5c4df597643e8133275207e919a8f))
- Pre-v1 Polish: UX Improvements & Bug Fixes ([#31](https://github.com/JackUait/blok/pull/31)) ([1917a221](https://github.com/JackUait/blok/commit/1917a2214f6f3c08923a3df6cf963949ae2125de))

## [0.4.1-beta.5](https://github.com/JackUait/blok/compare/v0.4.1-beta.4...v0.4.1-beta.5) (2025-12-07)

### 🐛 Bug Fixes

- external plugins may break because of Tailwind ([ee68032](https://github.com/JackUait/blok/commit/ee68032720482dbfba6cf9d3cf3602a6df755226))

### ✨ Features

- add data-blok-header-level to headers in the popover ([d27a758](https://github.com/JackUait/blok/commit/d27a7587803342279a10cbd7fdd317c984119fcd))

## [0.4.1-beta.4](https://github.com/JackUait/blok/compare/v0.4.1-beta.3...v0.4.1-beta.4) (2025-12-07)

### ♻️ Refactoring

- rollback React migration ([#16](https://github.com/JackUait/blok/pull/16)) ([558e620](https://github.com/JackUait/blok/commit/558e6201e1bd2fff6c333827be5cf149551fed3b))

## [0.4.1-beta.3](https://github.com/JackUait/blok/compare/v0.4.1-beta.2...v0.4.1-beta.3) (2025-12-06)

### ✨ Features

- implement undo/redo ([#15](https://github.com/JackUait/blok/pull/15)) ([207a4c1](https://github.com/JackUait/blok/commit/207a4c1fd3d5b65fb97c07e41b0e8933c60ee9ce))

## [0.4.1-beta.2](https://github.com/JackUait/blok/compare/v0.4.1-beta.1...v0.4.1-beta.2) (2025-12-05)

### ♻️ Refactoring

- migrate internals to React ([#14](https://github.com/JackUait/blok/pull/14)) ([ea36157](https://github.com/JackUait/blok/commit/ea3615702597d971171e377e938ee549185b220c))

## [0.4.1-beta.1](https://github.com/JackUait/blok/compare/v0.4.1-beta.0...v0.4.1-beta.1) (2025-12-03)

### 🧹 Chores

- **codemod** improve migration ([#13](https://github.com/JackUait/blok/pull/13)) ([3514c5b](https://github.com/JackUait/blok/commit/3514c5b34072bdc2788bd934822e1ba9de85f7d4))

## [0.4.1-beta.0](https://github.com/JackUait/blok/compare/v0.3.1-beta.0...v0.4.1-beta.0) (2025-12-16)

### ✨ Features

- **i18n** Hebrew, Persian, Urdu, Yiddish, Pashto, Sindhi, Uyghur, Kurdish and Dhivehi ([28191fd](https://github.com/JackUait/blok/commit/28191fd786d9e3ea2fffa4bd32cf99018b60e0cd))
- **i18n** add translations for Czech, Romanian and Hungarian ([8be8c17](https://github.com/JackUait/blok/commit/8be8c177a174606fb6821f7877180fe2439b13b0))
- **i18n** add translations for Thai, Ukrainian and Greek ([24584fe](https://github.com/JackUait/blok/commit/24584feae996f743824686c76cd8dcf376eadbbe))
- **i18n** add translations for Hindi, Bengali, Indonesian and Vietnamese ([e696674](https://github.com/JackUait/blok/commit/e6966745b799ca3d0d71b4c6e2594b0f983a226c))
- **i18n** add translations for Turkish and Azerbaijani ([ce381f6](https://github.com/JackUait/blok/commit/ce381f615c74b989b86866a3f4a21d56b241bb1f))
- **i18n** add translations for Arabic ([c2bd2c4](https://github.com/JackUait/blok/commit/c2bd2c4b358dfc8d21b5b2085341a8a1e7d90e94))
- **i18n** add translations for Dutch, Polish and Swedish ([5a7898e](https://github.com/JackUait/blok/commit/5a7898eec0ff19bc37176e0267611a0ae0cf82ec))
- **i18n** add translations for Korean ([fb0f0d5](https://github.com/JackUait/blok/commit/fb0f0d5b542437e2d21ebe95f866ddad57858f60))
- **i18n** add translations for Japanese ([f71fa79](https://github.com/JackUait/blok/commit/f71fa79eb85e260acae624c89f4faa389be92b86))
- **i18n** add translations for Italian ([f74790e](https://github.com/JackUait/blok/commit/f74790e4d40ab04f591084e7b39116e2e73ad92a))
- **i18n** add translations for Portuguese ([94f5bde](https://github.com/JackUait/blok/commit/94f5bde875875ec416c34a7e5915118cb1208baf))
- **i18n** add translations for German ([1f48c73](https://github.com/JackUait/blok/commit/1f48c73f7482e72e551347cb2220d89825829693))
- **i18n** add translations for French ([8d954f5](https://github.com/JackUait/blok/commit/8d954f51ebd2c298f4f8914efca65480e0833290))
- **i18n** add translation for Spanish ([f06f55b](https://github.com/JackUait/blok/commit/f06f55b2f247d2067525a09b696b55efcdb18a29))
- **i18n** add support for Armenian ([a891b61](https://github.com/JackUait/blok/commit/a891b6124657ad645d900e6048e52b8a5ea9fd42))
- **i18n** add support for Chinese (Mandarin) ([173f44b](https://github.com/JackUait/blok/commit/173f44bb06feba5db15f139a0b8e3600ecff481a))
- **i18n** add translation to Russian ([fc19d28](https://github.com/JackUait/blok/commit/fc19d288fc4f70b90319f809700eca3a27c21bfc))
- rename checklist into to-do list ([931e53c](https://github.com/JackUait/blok/commit/931e53c0f7273f397a22c03ef2f4da4b83bf80c1))
- update codemod to account for flat translations config and updated keys ([d1e4404](https://github.com/JackUait/blok/commit/d1e4404fc7012a089ef563aa50d13e1f589da364))
- make the translations object flat ([ffe4667](https://github.com/JackUait/blok/commit/ffe466783e9f4d540fb2a62b44c61567f1bce7b7))
- improve drag&drop ([#26](https://github.com/JackUait/blok/pull/26)) ([b5e48e1](https://github.com/JackUait/blok/commit/b5e48e199cb848df040b8f27f62091b3fe9edea6))
- **lists** move lists to the flat data model ([#25](https://github.com/JackUait/blok/pull/25)) ([4a259b4](https://github.com/JackUait/blok/commit/4a259b46e0f958a7975b5e2b43a97b5f752660e2))
- move to the flat data model ([#24](https://github.com/JackUait/blok/pull/24)) ([931e678](https://github.com/JackUait/blok/commit/931e678bde948b453a784e788641d80298633826))
- improve keyboard navigation ([#22](https://github.com/JackUait/blok/pull/22)) ([a01e2ba](https://github.com/JackUait/blok/commit/a01e2ba1b2aab46ec42b69e1ebc465e588569626))
- add tools for creating numbered lists, ordered lists and checklists ([#21](https://github.com/JackUait/blok/pull/21)) ([6625fe5](https://github.com/JackUait/blok/commit/6625fe536086e8e0249d7b151c6d65c08d55c64a))
- **paragraph tool** add custom configuration ([#20](https://github.com/JackUait/blok/pull/20)) ([30b3a05](https://github.com/JackUait/blok/commit/30b3a056dc73eb921f1dc3ad583bbef0f0c82878))
- **header tool** add custom configuration ([#19](https://github.com/JackUait/blok/pull/19)) ([74a8f72](https://github.com/JackUait/blok/commit/74a8f72b2b21bd8f0b27ecf56c90c9c206771837))
- implement the navigation mode ([#18](https://github.com/JackUait/blok/pull/18)) ([0c7dd77](https://github.com/JackUait/blok/commit/0c7dd772343f4ec7ac22df4e62a9bc068d5bda2c))
- various improvements ([#17](https://github.com/JackUait/blok/pull/17)) ([8a37c4d](https://github.com/JackUait/blok/commit/8a37c4dd7a2ddd418e640e2bd4777e6282b3be13))

### 🐛 Bug Fixes

- update translation keys to be camelCase ([f8858ea](https://github.com/JackUait/blok/commit/f8858eaea9dfbf370891f65f63947327a5d8fc4e))
- parsing translation keys ([ed114f8](https://github.com/JackUait/blok/commit/ed114f817bf9609c8fe0fa312ba80154ad758118))
- **i18n** remove redunant translation keys ([142252c](https://github.com/JackUait/blok/commit/142252c0512fd4209c2e641ebe1217902191f5cb))
- **i18n** add a missing word in the Russian translation ([4c7eb8b](https://github.com/JackUait/blok/commit/4c7eb8b1e43c3dfd20062aa78e2d61c91eb41e0f))
- make the fake selection display correctly ([#23](https://github.com/JackUait/blok/pull/23)) ([b303aea](https://github.com/JackUait/blok/commit/b303aea0727faaddc9d3c28a8bb145f0889bed73))
- close the inline toolbar on a click outside when the convert to menu is open ([0117d14](https://github.com/JackUait/blok/commit/0117d1455652a67594f9acaf91ff94223a69d265))
- keep the toolbar always centered ([888bb1f](https://github.com/JackUait/blok/commit/888bb1f378dc90e5aecb817439dc82120d029f77))

### 🧪 Tests

- fix failing E2E tests ([4c885e9](https://github.com/JackUait/blok/commit/4c885e94e1245442daf8a15ad13227616a467875))
- fix failing tests ([935c2d7](https://github.com/JackUait/blok/commit/935c2d7cbb75e6f8596176600773fd0ac8d8b5c9))
- fix failing tests ([a684403](https://github.com/JackUait/blok/commit/a684403f31c4b845c3a56b49c0aae19479a7f333))

### 🔧 CI/CD

- add validation for missing translations ([ee19ab3](https://github.com/JackUait/blok/commit/ee19ab3f699848f15e22c7c9e135dc47979236fe))
- update storybook:build script ([813b5ef](https://github.com/JackUait/blok/commit/813b5ef392510619ccbcd2cf3dab7dd73c4d9e7a))

### ♻️ Refactoring

- improve implementation ([0b615e9](https://github.com/JackUait/blok/commit/0b615e97d8c33ec879b8ce34cb21fa2a728e2fb8))

## [0.4.1](https://github.com/JackUait/blok/compare/v0.3.1-beta.0...v0.4.1) (2025-12-16)

> This is the same as 0.4.1-beta.0 but tagged as a stable release.

## [0.3.1-beta.0](https://github.com/JackUait/blok/compare/v0.3.0...v0.3.1-beta.0) (2025-12-03)

### 🧹 Chores

- **codemod** improve migration ([#13](https://github.com/JackUait/blok/pull/13)) ([3514c5b](https://github.com/JackUait/blok/commit/3514c5b34072bdc2788bd934822e1ba9de85f7d4))

## [0.3.0](https://github.com/JackUait/blok/compare/v0.2.0...v0.3.0) (2025-12-02)

### ✨ Features

- bundle tools paragraph and header ([fbf30d5](https://github.com/JackUait/blok/commit/fbf30d57403d3a3c8c0fea7f8d808327d0fcec91))
