# Meshtastic reuse and integration

## Selected upstream projects

- [meshtastic/python](https://github.com/meshtastic/python): used directly as the
  optional `meshtastic==2.7.11` dependency. Its public `MeshInterface.sendData`
  method handles the phone/host-to-device API. TCP, serial and BLE interface
  implementations remain upstream; this repository does not recreate them.
- [meshtastic/protobufs](https://github.com/meshtastic/protobufs): used through
  generated modules shipped by the SDK, including `Data`, `MeshPacket`,
  `ToRadio`, `FromRadio`, port numbers and priority enums. No schema fork or
  handwritten substitute for those messages is introduced.
- [meshtastic/Meshtasticator](https://github.com/meshtastic/Meshtasticator): the
  selected Phase 2 simulator integration target. Its interactive simulator runs
  native firmware nodes with simulated radio interfaces, and exposes TCP client
  connections. It can therefore accept this same SDK adapter. It has not been
  installed or run as part of Phase 1; full mesh tests remain outstanding.

The SDK project declares GPL-3.0-only. It is installed as an optional dependency;
its source is not copied into this repository. Preserve upstream notices and
review applicable distribution terms when distributing an SDK-enabled product.
Meshtasticator's README declares CC BY 4.0 and credits its simulation antecedents.

## Why the frame cap changed

[Meshtastic's packet layout](https://meshtastic.org/docs/overview/mesh-algo/)
allows a 16-byte radio header and at most 239 bytes of body. The body contains
serialized `Data`, plus 12 bytes when PKC/AEAD encryption is used. The upstream
[`DATA_PAYLOAD_LEN` constant](https://github.com/meshtastic/protobufs/blob/master/meshtastic/mesh.proto)
is 233, but it describes only `Data.payload`, excluding protobuf overhead.

A private port 256 takes three protobuf bytes; a 220-byte payload takes another
three bytes of field tag/length overhead. Total: 220 + 6 + 12 + 16 = **254** bytes,
within the documented 255-byte radio envelope, before LoRa PHY overhead.
The original 230-byte application cap would exceed that envelope with the same
encryption reserve. Version 2 therefore uses a 220-byte cap, 174-byte image chunks,
and at most 49 missing indices per frame. Both modes reserve encryption overhead;
PKI/channel negotiation and credentials remain the connected device's concern.

`data_message()` measures the **actual upstream protobuf** before accepting a
frame. `radio_size()` returns a conservative single-transmission byte count;
it is not an airtime estimate, excludes PHY overhead, and must be counted again
for relays/retries. Adding protobuf reply IDs or other fields requires recalculating
the budget. The bridge sends only port/payload in `Data` and sets no reply fields.

## Run the offline integration check

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e ".[meshtastic]"
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m imageoverbt.meshtastic_transport
```

The integration demo wraps the committed crop request, preview/crop manifests,
data packets and verified completion ACKs in official protobufs. It serializes
through `ToRadio`/`FromRadio`, reconstructs both representations byte for byte,
and confirms sender receipt only after the application's completion ACK returns.
It writes `demo-output/meshtastic.json`. This is an offline serialization and
endpoint check; it does not run firmware, measure RF, or claim reliable transport.

Tests also call the **real upstream `MeshInterface.sendData` and `_sendPacket`**
methods with only the final hardware write mocked. They cover port assignment,
packet generation, hop limits, priorities, PKI flag, incoming packet filtering,
subscription cleanup, malformed payloads and envelope sizes. Base-only installs
skip these optional tests; CI installs the extra and runs all tests.

Text and voice use the same bridge with tag-7 manifests and shared data/ACK
frames. See [TEXT_VOICE.md](TEXT_VOICE.md) for their codec and persistence contract.

## Adapter API

`imageoverbt.meshtastic_transport.Bridge` accepts an already-connected upstream
`MeshInterface`, a local uint32 node number and a receive callback. Construction
opens no connection. The caller owns its interface, database and outgoing queue.

```python
from queue import SimpleQueue
from imageoverbt.meshtastic_transport import Bridge

# interface is an upstream TCPInterface, SerialInterface or BLEInterface.
# local_node and remote_node come from the connected device/node database.
incoming = SimpleQueue()
with Bridge(interface, local_node, incoming.put, channel=0, hop_limit=3) as bridge:
    bridge.send(scheduled_frame, remote_node)
    # Endpoint owner drains incoming on its own thread and dispatches by frame type.
```

`send()` sends **one** scheduled frame, so transport can change priority between
packets. It validates the application frame and protobuf budget before calling
`sendData`. Use `background=True` for unsolicited refinement and
`pki_encrypted=True` when the connected session has appropriate key support.
No radio connection is opened by the offline demo or tests.

Private app port 256 is the upstream experimental default, not a globally unique
registered imageoverbt port. Other applications sharing it may collide; use an
isolated demo deployment. Incoming frames must pass version/type/CRC checks.
The bridge filters other ports, destinations, channel indices and interfaces.
For SDK callbacks it reads the official `MeshPacket` under the `raw` dictionary
key, avoiding JSON/base64 transformations.

`ReceivedFrame` preserves source, destination, packet ID and observed hop fields.
It cannot reveal the complete route. Endpoint dispatch must bind manifests to
expected sender/recipient node IDs, route requests to the source owner, and send
completion ACKs to the corresponding sender. Data frames go to `Store.receive`,
matching type-4 application ACKs go to `Store.confirm`, and missing-index frames
go to the transport retry queue. The bridge deliberately leaves endpoint dispatch,
queueing and retry/expiry policy to Phase 2.

The SDK invokes receive callbacks on its publishing thread. Queue frames back to
the endpoint owner's thread before touching `Store`; SQLite connections belong
to their creating thread. `Bridge.close()` removes its subscription and leaves
the caller's interface open. Malformed private-app frames raise `ValueError` for
the endpoint's failure/logging policy; unrelated traffic is ignored.

## Priority and acknowledgment semantics

The adapter uses upstream enum values: control frames use `RESPONSE`, requested
image data uses `DEFAULT`, and unsolicited refinement uses `BACKGROUND`.
Meshtastic's firmware priority is a local queue setting, not an end-to-end
scheduler guarantee. Fairness, backpressure and application packet boundaries
still belong to the Phase 2 scheduler; do not enqueue an entire photo into
firmware and assume the app can preempt it later.

`wantAck=False` and `wantResponse=False` avoid requesting native per-packet ACKs
or generic echoes. Selective retry control and verified representation ACKs are
application frames. Native `ROUTING_APP` ACKs are filtered and never call
`Store.confirm`; even a native delivery ACK does not prove an image was assembled
and verified. This boundary does not yet provide retry scheduling by itself.

## Phase 2 simulator handoff

Follow upstream's [interactive simulator guide](https://github.com/meshtastic/Meshtasticator/blob/master/INTERACTIVE_SIM.md)
to provision native firmware/Docker nodes and connect the official `TCPInterface`
to each node's exposed TCP port. Match the bridge's node/channel settings to
those devices. Simulator setup is an explicit integration step, not performed
by importing this package. Keep simulator-only route observations separate from
`ReceivedFrame` endpoint evidence.

Before marking Phase 2 complete, exercise the plan's five-node topology, loss,
interruption, packet-boundary priority, fairness, selective retransmission and lost
completion ACK scenarios against the simulator. Record upstream firmware and
simulator commit IDs, radio presets and scenario seeds in those results. The
adapter establishes the shared packet boundary; it does not substitute for those
acceptance tests.
