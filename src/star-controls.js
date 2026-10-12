import { CRFControls4D } from './controls4d.js';

// Retain the upstream gestures and inertia. The 3D analogue lives in XYW;
// its unused Z axis must stay fixed even with arcball and two-finger gestures.
export class StarControls extends CRFControls4D {
    dimension = 4;
    inertia = true;
    useArcball = false;
    applyArcballTilt(v, arcball, depthIndex) {
        // The projected near hemisphere uses negative depth. Tilt toward the
        // pointer on that hemisphere, independently of the drag's direction.
        const tilt = arcball ? { ...arcball, s: -arcball.s } : null;
        return super.applyArcballTilt(v, tilt, this.dimension === 3 && depthIndex === 2 ? 3 : depthIndex);
    }
    rotate3D(dx, dy, dt, arcball) {
        // Rendering reverses visible Z to match Three's camera convention.
        // Reverse the visible 3D spin so front points follow the screen drag.
        if (this.dimension === 4) return super.rotate3D(-dx, -dy, dt, arcball);
        super.rotate4D(dx, dy, dt, arcball);
        if (this.lastAutoCandidate) this.lastAutoCandidate.channel = 1;
    }
    startAutoRotation(candidate) {
        if (this.inertia) super.startAutoRotation(candidate);
    }
}
