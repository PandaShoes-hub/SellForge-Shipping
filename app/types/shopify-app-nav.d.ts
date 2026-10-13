import type { ReactNode } from "react";

// Tipos para o elemento Shopify App Bridge <s-app-nav>.
// Declarado nos dois namespaces JSX usados em projetos React/Shopify.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": { children?: ReactNode };
    }
  }
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": { children?: ReactNode };
    }
  }
}
