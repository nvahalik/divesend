// Shown when the browser has no Web Bluetooth API (Firefox, desktop Safari, iOS
// Safari). DiveSend can't reach a dive computer without it, so point the user at a
// browser that works.

const CHROME_URL = 'https://www.google.com/chrome/';
const BLUEFY_URL = 'https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055';

export function BluetoothUnsupportedNotice() {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">This browser can&rsquo;t connect to dive computers</p>
      <p className="mt-1">
        DiveSend uses Web Bluetooth to read your dive computer, and this browser doesn&rsquo;t support it. Open DiveSend in
        one of these instead:
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        <li>
          <a href={CHROME_URL} target="_blank" rel="noreferrer" className="font-medium underline">
            Google Chrome
          </a>{' '}
          &mdash; Windows, macOS, Linux, Android
        </li>
        <li>
          <a href={BLUEFY_URL} target="_blank" rel="noreferrer" className="font-medium underline">
            Bluefy
          </a>{' '}
          &mdash; iPhone &amp; iPad
        </li>
      </ul>
    </div>
  );
}
