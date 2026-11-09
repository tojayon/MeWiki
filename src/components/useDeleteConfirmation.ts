import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";

interface DeleteOptions {
  title: string;
  description: string;
  focusOnCancel?: HTMLElement;
}
export interface DeleteRequest extends DeleteOptions {
  owner: object;
  trigger: HTMLElement | null;
  onConfirm: () => void;
}
export interface DeleteContext {
  request: (request: DeleteRequest) => void;
  cancel: (owner: object) => void;
}
export const DeleteConfirmationContext = createContext<DeleteContext | null>(
  null,
);

export function useDeleteConfirmation() {
  const context = useContext(DeleteConfirmationContext);
  if (!context) throw new Error("DeleteConfirmationProvider is required");
  const owner = useRef({});
  useLayoutEffect(() => {
    const token = owner.current;
    return () => context.cancel(token);
  }, [context]);
  return useCallback(
    (options: DeleteOptions, onConfirm: () => void) =>
      context.request({
        ...options,
        onConfirm,
        owner: owner.current,
        trigger:
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
      }),
    [context],
  );
}
