<p align="center">
  <img src="icons/logo.png" alt="Web Select" width="128">
</p>

<h1 align="center">Web Select</h1>

<p align="center">Select an area of a web page and copy its text with formatting, just like Edge's old <em>Web select</em>.</p>

---

Press **Ctrl+Shift+S**, click the toolbar icon, or choose **Markera och kopiera område** from the right-click menu. Then drag a rectangle over what you want to copy, much like the Snipping Tool. While you drag, the exact words and table cells that will be copied are highlighted. When you release, the content goes to your clipboard.

Tables paste into Excel as real cells. Headings, lists, bold text, and links are kept when you paste into Word or Outlook.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder.

You can change the shortcut at `chrome://extensions/shortcuts`. Press Esc or right-click to cancel a selection.

## Limitations

- Doesn't work on `chrome://` pages or in the Chrome Web Store.
- Content drawn on a canvas, such as Google Sheets, can't be read.
- Only what's visible in the window is copied. Content inside iframes isn't included.
