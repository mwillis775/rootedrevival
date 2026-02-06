# Rotating 3D Asset Ideas for Rooted Revival

These are visual assets that rotate/tumble/animate in the `wireframe-container` beneath each section. Like the globe.gif you have for section 01, each section needs a thematic animated visual.

---

## ASSET_01: PRIMARY_DIRECTIVE (Globe)
**Current**: `globe.gif` ✓

**Alternatives/Upgrades**:
- **Wireframe Earth** - Low-poly wireframe globe with green lines on black, slowly rotating 
- **Root System Globe** - Earth with visible root networks spreading across continents
- **Breathing Planet** - Globe that subtly pulses/breathes in addition to rotating

**How to create**:
- Blender: UV sphere with wireframe modifier, rendered as GIF
- Three.js: Real-time WebGL globe (more interactive but heavier)
- After Effects: Looping rotation of 3D earth model

---

## ASSET_02: SYSTEMS_ENGINEERING (Manifold Geometry)
**Placeholder**: `[ASSET_02: MANIFOLD_GEOMETRY // AXIS_TUMBLE_LONGITUDINAL]`

**Concepts**:
- **Aeroponic Manifold** - 3D model of spray nozzle array slowly rotating, showing all angles
- **Control Loop Diagram** - Animated feedback loop with signals flowing through
- **Pressure Vessel** - Cross-section accumulator tank rotating to show internal structure
- **Sensor Array** - Cluster of probes (EC, pH, temp) spinning on vertical axis
- **PID Wave** - Animated sine wave stabilizing to setpoint

**Style notes**:
- Green wireframe on black background
- Slow rotation (10-15 second full revolution)
- Optional: Subtle particle effects for "data flow"

---

## ASSET_03: BOTANICAL_GENETICS (Double Helix)
**Placeholder**: `[ASSET_03: DOUBLE_HELIX // ISOMETRIC_QUATERNION_ROTATION]`

**Concepts**:
- **DNA Strand** - Classic double helix rotating on vertical axis, base pairs visible
- **Chromosome Set** - Stylized plant chromosomes (n=10 for cannabis) arranging
- **Gene Sequence** - ATCG letters flowing along helix structure
- **Root to Shoot** - Morphing animation from root tip to flowering apex
- **Phenotype Matrix** - Grid of plant silhouettes with one highlighted, cycling

**Style notes**:
- Consider amber (#ffb000) accents for genetic "active" sites
- Helix should have visible rungs/base pairs
- Rotation can be on slight tilt for more dynamic feel

---

## ASSET_04: FABRICATION_LAB (Engine Block / Mechanical)
**Placeholder**: `[ASSET_04: ENGINE_BLOCK // GIMBAL_TUMBLE_X_Z]`

**Concepts**:
- **Engine Block** - Cross-section mechanical engine rotating on gimbal
- **3D Printer Extruder** - Hotend assembly with visible filament path
- **CNC Spindle** - Machining head with tool holder rotating
- **Gear Assembly** - Interlocking gears that actually turn as they rotate
- **Stress Analysis** - Mesh model showing FEA stress colors morphing

**Style notes**:
- Gimbal rotation = rotation on multiple axes simultaneously
- Can show internal/cutaway views
- Mechanical parts should feel industrial, precise

---

## ASSET_05: OPEN_SCHOLAR (Books / Knowledge)
**Placeholder**: `[ASSET_05: BOOK_STACK // ORBITAL_ROTATION_Y]`

**Concepts**:
- **Orbiting Books** - Stack of books with pages that orbit around like electrons
- **Citation Network** - Nodes connected by lines, slowly rotating cluster
- **Open Book** - Single book with pages turning, text visible as glyphs
- **IPFS Hash** - CID string that morphs/types out character by character
- **Paper Flow** - Documents flowing into a central node, then replicating outward

**Style notes**:
- Cyan (#00ffff) accents for IPFS/network elements
- Books can be stylized/abstract, not photorealistic
- "Orbital" = elements circling a center point

---

## ASSET_06: DOWNLOAD_NODE (Network Mesh)
**Placeholder**: `[ASSET_06: NETWORK_MESH // PARTICLE_FLOW_XYZ]`

**Concepts**:
- **P2P Network** - Nodes appearing, connecting with lines, pulsing with data
- **IPFS Constellation** - Scattered nodes forming mesh pattern, slowly rotating as unit
- **Download Arrow** - Stylized arrow with particle stream flowing downward
- **Desktop + Network** - Computer icon with network tendrils extending outward
- **Decentralization Burst** - Single node splitting into many, distributing outward

**Style notes**:
- Particle effects for "data flowing"
- Nodes should pulse when "active"
- Consider animating new connections forming

---

## Technical Approaches

### GIF (Like your globe.gif)
**Pros**: Simple, universal support, no JavaScript needed
**Cons**: Large file size for smooth animation, fixed resolution
**Tools**: Blender → render animation → Photoshop/GIMP convert to GIF

### CSS Animation
**Pros**: Lightweight, scales perfectly, smooth
**Cons**: Limited to 2D transforms or simple 3D
**Example**: SVG with CSS `@keyframes` rotation

```css
.rotating-asset {
    animation: rotate3d 15s linear infinite;
}
@keyframes rotate3d {
    from { transform: rotateY(0deg); }
    to { transform: rotateY(360deg); }
}
```

### Three.js / WebGL
**Pros**: True 3D, interactive, sharp at any size
**Cons**: Requires JavaScript, heavier load
**Good for**: Complex geometry, particle systems

### Lottie Animation
**Pros**: Vector-based, small files, smooth
**Cons**: Requires Lottie player library
**Tools**: After Effects → Bodymovin export

---

## Quick Win: CSS-Only Wireframe Cube

If you want something immediate while you create proper assets:

```html
<div class="wireframe-cube">
    <div class="face front"></div>
    <div class="face back"></div>
    <div class="face left"></div>
    <div class="face right"></div>
    <div class="face top"></div>
    <div class="face bottom"></div>
</div>
```

```css
.wireframe-cube {
    width: 100px;
    height: 100px;
    position: relative;
    transform-style: preserve-3d;
    animation: spin 10s linear infinite;
}
.face {
    position: absolute;
    width: 100px;
    height: 100px;
    border: 1px solid #33ff33;
    background: transparent;
}
/* Position each face... */
@keyframes spin {
    from { transform: rotateX(0) rotateY(0); }
    to { transform: rotateX(360deg) rotateY(360deg); }
}
```

---

## Recommended Priority

1. **ASSET_05 (Open Scholar)** - New section, needs visual
2. **ASSET_06 (Download Node)** - New section, high visibility
3. **ASSET_02 (Manifold)** - Core to your CEA work
4. **ASSET_03 (Helix)** - Classic, recognizable
5. **ASSET_04 (Engine)** - Cool but complex

---

## Resources for Creating

- **Blender** (free): Best for 3D wireframe renders
- **Three.js** (free): Real-time WebGL
- **Spline.design** (free tier): Easy 3D for web
- **Jitter.video** (free tier): Motion design for web
- **LottieFiles** (free): Pre-made animations you can customize

*Created: January 2026*
