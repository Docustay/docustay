// The the platform app tile — the deep-violet rounded square with the two interlocking octagons (the maintainer's logo; files in public/brand, from ~/example-rebuild/brand,
// pixel-identical to ~/Downloads/keystone-tile-180/192.png). It is a raster tile because no master vector of THIS tile exists in the repo (the older
// vector "interlock" mark that used to live here has different proportions and colours); see specs/PLATFORM-LOGO-AUDIT.md.
export default function WorkbenchMark({ className = "h-8 w-8", ...rest }) {
  return (
    <img src="/brand/workbench-tile-128.png" srcSet="/brand/workbench-tile-128.png 1x, /brand/workbench-tile-256.png 2x" alt="" width={40} height={40} className={className} aria-hidden="true" {...rest} />
  );
}
