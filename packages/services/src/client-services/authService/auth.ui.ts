import type { ServiceUISchema } from "@kloks/contracts";

export const AuthServiceUISchema: ServiceUISchema = {
  schemaId: "kloks.service.auth.ui",
  schemaVersion: "1.0.0",
  serviceId: "kloks.service.auth",
  requirementMode: "required",
  pages: [{
    name: "Auth.ui",
    description: "Luth-backed authentication UI",
    sections: [{
      name: "Auth.ui.LoginSection",
      description: "Authentication is delegated to the canonical Luth service.",
      assetRef: { packageId: "@ultrst-armada/floks", packageVersion: "^1.13.15", exportPath: "ui", assetId: "AuthPage", assetVersion: "1.0.0" },
      components: [
        { name: "Auth.ui.LoginSection.AuthPage", assetRef: { packageId: "@ultrst-armada/floks", packageVersion: "^1.13.15", exportPath: "ui", assetId: "AuthPage", assetVersion: "1.0.0" } },
        { name: "Auth.ui.LoginSection.LoginModal", assetRef: { packageId: "@ultrst-armada/floks", packageVersion: "^1.13.15", exportPath: "ui", assetId: "LoginModal", assetVersion: "1.0.0" } },
      ],
    }],
  }],
  operationBindings: [
    { operationId: "AuthClientService.login", uiPath: "Auth.ui.LoginSection" },
    { operationId: "AuthClientService.register", uiPath: "Auth.ui.LoginSection" },
  ],
};
