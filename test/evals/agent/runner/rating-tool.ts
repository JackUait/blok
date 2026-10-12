/** Added to the page as a script tag; mirrors test/fixtures/agent-commands/custom-tools/rating.json. */
export const RATING_TOOL_SOURCE = `
class RatingTool {
  static get toolbox() { return { title: 'Rating', name: 'rating' }; }
  static describe() {
    return {
      summary: 'A star rating from 0 to 5.',
      data: { type: 'object', properties: { value: { type: 'integer', minimum: 0, maximum: 5 } }, required: ['value'], additionalProperties: false },
      actions: [{ name: 'setValue', summary: 'Set the rating.', target: 'block',
        args: { type: 'object', properties: { value: { type: 'integer', minimum: 0, maximum: 5 } }, required: ['value'], additionalProperties: false } }],
    };
  }
  static get actionHandlers() {
    return { setValue: { run: (ctx, args) => { ctx.update(ctx.block.id, { value: args.value }); return {}; } } };
  }
  constructor({ data }) { this.data = { value: typeof data?.value === 'number' ? data.value : 0 }; }
  render() { const el = document.createElement('div'); el.textContent = '★'.repeat(this.data.value); return el; }
  save() { return { value: this.data.value }; }
}
window.EvalRatingTool = RatingTool;
`;
