# Evans

Evans is a Chrome extension that detects changes on web pages. It checks the pages you choose at regular intervals, keeps a local history, and highlights added and removed text. You can receive notifications and narrow monitoring to a specific section of a page or to changes that match your keywords.

## Use cases

- Follow pages without RSS feeds, such as notice boards, calls for applications, and job listings.
- Track updates to documentation, calendars, or release notes.
- Watch a product's price or availability by selecting the section that shows it.

## Requirements and installation

Evans requires Google Chrome 120 or later. You can load the extension directly from the source files without a build step or additional dependencies.

1. On GitHub, select **Code → Download ZIP** and extract the archive. You can also clone the repository with Git.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** and select **Load unpacked**.
4. Select the `extension/` folder, which contains `manifest.json`.
5. Open Evans from Chrome's Extensions menu. You can pin it to the toolbar for quick access.

To update, replace the files in the same folder and click **Reload** on `chrome://extensions`. You can export a backup from **Settings** before updating.

## Getting started

1. Open the dashboard, select **Add pages**, and paste one URL per line. You can also select open tabs or choose **Monitor this site with Evans** from the toolbar popup.
2. Choose a check interval and a capture mode. **HTML only** reads the HTML returned by the site. **Rendered** loads the page in a temporary tab for content that depends on JavaScript and can use your Chrome session.
3. Run the first check to establish a baseline. Subsequent checks compare the page with its last successful capture.
4. Open **Changes** to review differences and **Runs** to see the results of each check.

Keep Chrome running and your computer awake for scheduled checks. Chrome may delay alarms.

## Data and permissions

Every new installation starts with an empty watchlist. Evans stores monitored pages, preferences, and comparisons in your local Chrome profile. It requests access to HTTP and HTTPS sites so it can check the URLs you add.

You can export a JSON archive and import compatible backups from **Settings**. Exported archives can contain URLs and captured text, so keep them private. Uninstalling Evans removes its local storage from Chrome.

## Development

The extension lives in `extension/`, tests in `tests/`, and development tools in `scripts/`. The commands below require Node.js 22 or later. Packaging also requires the `zip` command.

| Command | Purpose |
| --- | --- |
| `npm test` | Run the automated tests. |
| `npm run check` | Check syntax and manifest resources. |
| `npm run package` | Generate `output/Evans-Chrome.zip`. |
| `npm run preview` | Start a local UI preview. Monitoring requires the installed extension. |

## License

[MIT](LICENSE).
