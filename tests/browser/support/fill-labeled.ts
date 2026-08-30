import { expect, type Locator, type Page } from "@playwright/test";

export async function fillLabeled(page: Page, label: string, value: string) {
  await fillExact(page.getByLabel(label), value);
}

export async function fillExact(locator: Locator, value: string) {
  await locator.click();
  await locator.evaluate((el, next) => {
    const input = el as HTMLInputElement | HTMLTextAreaElement;
    input.focus();
    input.value = next;
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText", data: next }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await expect(locator).toHaveValue(value);
}
