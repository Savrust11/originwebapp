import { register } from "node:module";
register("./bridge-loader.mjs", import.meta.url);
register("./native-adapter.mjs", import.meta.url);