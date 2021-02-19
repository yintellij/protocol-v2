pragma solidity 0.6.12;

interface IAaveOracle {
    function setAssetSources(address[] calldata assets, address[] calldata sources) external;
}