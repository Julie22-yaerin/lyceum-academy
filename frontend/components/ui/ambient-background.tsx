export function AmbientBackground() {
  return (
    <div className="ambient-bg">
      <div
        className="ambient-orb"
        style={{
          width: "600px",
          height: "600px",
          top: "-10%",
          left: "-5%",
          background: "radial-gradient(circle, rgba(129,140,248,0.15) 0%, transparent 70%)",
          animation: "ambient-drift 20s ease-in-out infinite"
        }}
      />
      <div
        className="ambient-orb"
        style={{
          width: "500px",
          height: "500px",
          bottom: "-15%",
          right: "-5%",
          background: "radial-gradient(circle, rgba(34,211,238,0.1) 0%, transparent 70%)",
          animation: "ambient-drift-2 25s ease-in-out infinite"
        }}
      />
      <div
        className="ambient-orb"
        style={{
          width: "400px",
          height: "400px",
          top: "40%",
          left: "50%",
          transform: "translateX(-50%)",
          background: "radial-gradient(circle, rgba(167,139,250,0.08) 0%, transparent 70%)",
          animation: "ambient-drift 18s ease-in-out infinite 5s"
        }}
      />
      <div
        className="ambient-orb"
        style={{
          width: "350px",
          height: "350px",
          top: "60%",
          left: "15%",
          background: "radial-gradient(circle, rgba(96,165,250,0.08) 0%, transparent 70%)",
          animation: "ambient-drift-2 22s ease-in-out infinite 3s"
        }}
      />
    </div>
  );
}
