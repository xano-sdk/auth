// The workspace `npm run test:live` deploys: the module on its own, as a project installs it.
import { workspace } from "@xano/sdk";
import { registerAuth } from "../../src/index.js";

export default registerAuth(workspace("auth-live"), { canonical: "authn" });
