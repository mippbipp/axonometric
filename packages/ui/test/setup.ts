declare global {
  var __UI_SDK_STRICT__: boolean | undefined;
}

globalThis.__UI_SDK_STRICT__ = true;

export const noRects = document.createElement("div").getClientRects();

// jsdom lacks these, or has them without the parts ui-sdk needs, so they're
// assigned rather than defaulted.
HTMLElement.prototype.showPopover = function showPopover() {};

HTMLElement.prototype.hidePopover = function hidePopover() {};

Element.prototype.getAnimations = () => [];

Element.prototype.scrollIntoView = function scrollIntoView() {};

Element.prototype.checkVisibility = () => true;

Element.prototype.getClientRects = () => noRects;

document.elementFromPoint = () => null;

document.elementsFromPoint = () => [];

globalThis.ResizeObserver ??= class {
  public observe() {}
  public unobserve() {}
  public disconnect() {}
};

document.head.append(
  Object.assign(document.createElement("style"), {
    textContent: "[popover] { display: block !important }",
  })
);
