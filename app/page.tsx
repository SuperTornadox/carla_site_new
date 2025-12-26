import "./root.css";

export const viewport = {
  width: "device-width",
  initialScale: 0,
};

export default function RootHomePage() {
  return (
    <div className="container">
      <div className="top-left">
        <a href="/blog/" target="_self">
          ENTER &nbsp;&nbsp;
        </a>
      </div>

      <br />
      <br />

      <div className="left">
        <a href="/blog/" target="_self">
          <p>CARLA GANNIS STUDIO</p>
        </a>
      </div>

      <br />
      <br />
    </div>
  );
}
