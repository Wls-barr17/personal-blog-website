declare module 'framer-motion' {
  import type { ComponentType } from 'react';
  export const motion: { section: ComponentType<any>; div: ComponentType<any>; button: ComponentType<any> };
  export const AnimatePresence: ComponentType<any>;
}
