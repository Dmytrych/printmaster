import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const RELATIVE_WITHOUT_JS = ":not([source.value=/\\.js$/])";
const message = 'Relative imports/exports must end with ".js" (e.g. "./foo.js").';

export default tseslint.config(
  // `**/` prefix: this config sits at the workspace root, so bare names would only match backend/dist etc.
  { ignores: ["**/dist/", "**/node_modules/", "**/cdk.out/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        ...["ImportDeclaration", "ExportAllDeclaration", "ExportNamedDeclaration"].map((type) => ({
          selector: `${type}[source.value=/^\\./]${RELATIVE_WITHOUT_JS}`,
          message,
        })),
      ],
    },
  },
);
