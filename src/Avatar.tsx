import { memo } from "react";
import { Logo } from "./ui";

export const Avatar = memo(function Avatar({
  role,
  src,
}: {
  role: "user" | "assistant";
  src?: string;
}) {
  return (
    <span className={`avatar avatar-${role}`} aria-hidden="true">
      {role === "assistant" ? <Logo small /> : <span>你</span>}
      {src && (
        <img
          key={src}
          src={src}
          alt=""
          draggable={false}
          onError={(e) => {
            e.currentTarget.hidden = true;
          }}
        />
      )}
    </span>
  );
});
