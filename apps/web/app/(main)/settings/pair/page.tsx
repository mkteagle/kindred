import { PairDeviceForm } from "@/components/kx/pair-device-form";

export default function PairDevicePage() {
  return (
    <section className="kx-task-surface kx-pair-page">
      <h2 className="kx-setting-title">Pair a device</h2>
      <p className="kx-lede">In Kindred on your iPhone, tap <strong>Scan a pairing code</strong> to sign in to this household.</p>
      <PairDeviceForm />
    </section>
  );
}
