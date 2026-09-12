// A fuller configuration example than the one `init` writes.
//
// Paths are relative to this file. Put it at the root of the project whose
// docs you are mirroring — it is what marks that root, so the commands behave
// the same whatever directory you run them from.

export default {
    sources: [
        {
            // The id in the Confluence URL of the page or folder to mirror:
            // …/spaces/HANDBOOK/folder/1845363038 → '1845363038'
            rootId: '1845363038',
            outDir: 'docs/specs',
            label: 'Specifications',
        },
        {
            // A second tree. Each one gets its own index and its own sidebar
            // section; they are pulled and pushed in the order listed here.
            rootId: '1845363999',
            outDir: 'docs/architecture',
            label: 'Architecture',
        },
    ],

    serve: {
        port: 4801,
        title: 'Product documentation',

        // Defaults to the closest directory containing every outDir — 'docs'
        // for the two sources above. Set it explicitly to serve a wider tree.
        root: 'docs',

        // Hand-written markdown to show alongside the mirrors. Never read or
        // written by pull and push, so notes here survive a pull.
        sections: [
            { label: 'Working notes', dir: 'docs/notes' },
        ],
    },
};
