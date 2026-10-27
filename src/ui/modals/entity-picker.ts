import { FuzzySuggestModal, type App } from 'obsidian';

export interface PickItem {
  id: string;
  label: string;
}

/** Native Obsidian fuzzy picker for entities (keyboard-friendly). */
export class EntityPickerModal extends FuzzySuggestModal<PickItem> {
  private chosen = false;
  constructor(
    app: App,
    private readonly items: PickItem[],
    placeholder: string,
    private readonly resolve: (id: string | null) => void,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems(): PickItem[] {
    return this.items;
  }
  getItemText(item: PickItem): string {
    return item.label;
  }
  onChooseItem(item: PickItem): void {
    this.chosen = true;
    this.resolve(item.id);
  }
  override onClose(): void {
    super.onClose();
    // onChooseItem fires after onClose in some versions; defer the null resolution.
    window.setTimeout(() => {
      if (!this.chosen) this.resolve(null);
    }, 50);
  }
}
